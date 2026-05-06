import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import {
  CREDITS_PER_DOLLAR,
  MIN_PURCHASE_DOLLARS,
  dollarsToCredits,
  dollarsToMinorUnits,
} from '@/lib/payment/packs';
import { getRazorpayInstance } from '@/lib/payment/razorpay-client';

const bodySchema = z.object({
  amountDollars: z.number().min(MIN_PURCHASE_DOLLARS),
});

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Minimum purchase is $${MIN_PURCHASE_DOLLARS}` },
        { status: 400 }
      );
    }

    const amountDollars = Number(parsed.data.amountDollars.toFixed(2));
    const amountMinor = dollarsToMinorUnits(amountDollars);
    const credits = dollarsToCredits(amountDollars);

    if (credits <= 0) {
      return NextResponse.json({ error: 'Invalid credit amount' }, { status: 400 });
    }

    const rzp = getRazorpayInstance();
    const receipt = `u_${session.user.id.slice(0, 12)}_${Date.now()}`;

    const rzOrder = await rzp.orders.create({
      amount: amountMinor,
      currency: 'USD',
      receipt,
      notes: {
        userId: session.user.id,
        amountDollars: String(amountDollars),
        credits: String(credits),
      },
    });

    await prisma.razorpayOrder.create({
      data: {
        razorpayOrderId: rzOrder.id as string,
        userId: session.user.id,
        packId: `custom_${amountDollars}`,
        amountMinor,
        currency: 'USD',
        credits,
      },
    });

    const keyId =
      process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? process.env.RAZORPAY_KEY_ID;
    if (!keyId) {
      throw new Error('Set NEXT_PUBLIC_RAZORPAY_KEY_ID or RAZORPAY_KEY_ID');
    }

    return NextResponse.json({
      orderId: rzOrder.id,
      amount: amountMinor,
      currency: 'USD',
      keyId,
      credits,
      amountDollars,
      creditsPerDollar: CREDITS_PER_DOLLAR,
    });
  } catch (e) {
    console.error('[create-order]', e);
    return NextResponse.json(
      { error: 'Could not create order' },
      { status: 500 }
    );
  }
}
