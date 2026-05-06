import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/auth';
import { applyCapturedPayment } from '@/lib/payment/process-payment';
import { verifyRazorpayCheckoutSignature } from '@/lib/payment/verify-webhook';

const bodySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const payload = parsed.data;
    const verified = verifyRazorpayCheckoutSignature({
      orderId: payload.razorpay_order_id,
      paymentId: payload.razorpay_payment_id,
      signature: payload.razorpay_signature,
      keySecret: process.env.RAZORPAY_KEY_SECRET,
    });

    if (!verified) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    await applyCapturedPayment({
      razorpayPaymentId: payload.razorpay_payment_id,
      razorpayOrderId: payload.razorpay_order_id,
      amountMinor: 0,
      status: 'captured',
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[payments.confirm]', error);
    return NextResponse.json({ error: 'Could not confirm payment' }, { status: 500 });
  }
}
