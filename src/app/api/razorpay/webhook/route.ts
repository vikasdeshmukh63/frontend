import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { reverseCreditsForRefund } from '@/lib/credit-service';
import { applyCapturedPayment } from '@/lib/payment/process-payment';
import { verifyRazorpayWebhookSignature } from '@/lib/payment/verify-webhook';

export const runtime = 'nodejs';

type RazorpayWebhookBody = {
  id?: string;
  event?: string;
  payload?: {
    payment?: { entity?: PaymentEntity };
    refund?: { entity?: RefundEntity };
  };
};

type PaymentEntity = {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
};

type RefundEntity = {
  id?: string;
  payment_id?: string;
  amount?: number;
};

export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature');

  const ok = verifyRazorpayWebhookSignature(
    raw,
    signature,
    process.env.RAZORPAY_WEBHOOK_SECRET
  );
  if (!ok) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(raw) as RazorpayWebhookBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventId = body.id ?? `${body.event}-${raw.slice(0, 64)}`;
  const eventType = body.event ?? 'unknown';

  try {
    await prisma.webhookEvent.create({
      data: {
        eventId,
        eventType,
      },
    });
  } catch {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    if (body.event === 'payment.captured') {
      await handlePaymentCaptured(body);
    } else if (
      body.event === 'refund.processed' ||
      body.event === 'refund.created'
    ) {
      await handleRefund(body);
    }
  } catch (e) {
    console.error('[razorpay webhook]', e);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function handlePaymentCaptured(body: RazorpayWebhookBody) {
  const entity = body.payload?.payment?.entity;
  if (!entity?.id || !entity.order_id) return;

  await applyCapturedPayment({
    razorpayPaymentId: String(entity.id),
    razorpayOrderId: String(entity.order_id),
    amountMinor: Number(entity.amount ?? 0),
    currency: entity.currency,
    status: entity.status,
  });
}

async function handleRefund(body: RazorpayWebhookBody) {
  const entity = body.payload?.refund?.entity;
  if (!entity?.id || !entity.payment_id) return;

  const razorpayPaymentId = String(entity.payment_id);
  const refundAmount = Number(entity.amount ?? 0);

  const payment = await prisma.razorpayPayment.findUnique({
    where: { razorpayPaymentId },
    include: { order: true },
  });
  if (!payment) return;

  const creditsPurchased = payment.order.credits;
  const paymentTotal = payment.amountMinor;
  let creditsToReverse = creditsPurchased;
  if (refundAmount > 0 && paymentTotal > 0 && refundAmount < paymentTotal) {
    creditsToReverse = Math.max(
      1,
      Math.floor((creditsPurchased * refundAmount) / paymentTotal)
    );
  }

  try {
    await prisma.refundRecord.create({
      data: {
        razorpayRefundId: String(entity.id),
        paymentId: payment.id,
        amountMinor: refundAmount || payment.amountMinor,
        currency: payment.currency,
        status: 'processed',
      },
    });
  } catch {
    return;
  }

  await reverseCreditsForRefund({
    userId: payment.order.userId,
    creditsToReverse,
    razorpayPaymentId,
    reason: 'razorpay_refund',
  });
}
