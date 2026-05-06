import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { getRazorpayInstance } from '@/lib/payment/razorpay-client';

const bodySchema = z.object({
  razorpayPaymentId: z.string().min(1),
  /** Partial refund in smallest currency unit; omit for full refund of captured payment. */
  amountMinor: z.number().int().positive().optional(),
});

/**
 * Server/admin-triggered refund; Razorpay will emit webhook events that reconcile credits.
 */
export async function POST(req: Request) {
  const refundSecret = process.env.PAYMENTS_REFUND_SECRET;
  if (!refundSecret) {
    return NextResponse.json(
      { error: 'Refunds are not configured' },
      { status: 503 }
    );
  }

  const header = req.headers.get('x-refund-secret');
  if (header !== refundSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const { razorpayPaymentId, amountMinor } = parsed.data;

    const payment = await prisma.razorpayPayment.findUnique({
      where: { razorpayPaymentId },
      include: { order: true },
    });

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    const rzp = getRazorpayInstance();
    const opts =
      amountMinor !== undefined
        ? { amount: amountMinor, notes: { source: 'payments_refund_api' } }
        : { notes: { source: 'payments_refund_api' } };

    const refund = await rzp.payments.refund(razorpayPaymentId, opts);

    return NextResponse.json({ ok: true, refund });
  } catch (e) {
    console.error('[refund]', e);
    return NextResponse.json({ error: 'Refund failed' }, { status: 500 });
  }
}
