import { CreditLedgerType, RazorpayOrderStatus } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';

type Params = {
  razorpayPaymentId: string;
  razorpayOrderId: string;
  amountMinor: number;
  currency?: string;
  status?: string;
};

export async function applyCapturedPayment(params: Params): Promise<boolean> {
  const { razorpayPaymentId, razorpayOrderId, amountMinor, currency, status } =
    params;

  const order = await prisma.razorpayOrder.findUnique({
    where: { razorpayOrderId },
  });
  if (!order || order.status === RazorpayOrderStatus.PAID) return false;

  let applied = false;

  await prisma.$transaction(async (tx) => {
    const existingPay = await tx.razorpayPayment.findUnique({
      where: { razorpayPaymentId },
    });
    if (existingPay) {
      return;
    }

    await tx.razorpayPayment.create({
      data: {
        razorpayPaymentId,
        orderId: order.id,
        amountMinor,
        currency: currency ?? order.currency,
        status: status ?? 'captured',
      },
    });

    await tx.razorpayOrder.update({
      where: { id: order.id },
      data: { status: RazorpayOrderStatus.PAID },
    });

    await tx.creditBalance.upsert({
      where: { userId: order.userId },
      create: { userId: order.userId, balance: 0 },
      update: {},
    });

    await tx.creditBalance.update({
      where: { userId: order.userId },
      data: { balance: { increment: order.credits } },
    });

    await tx.creditLedger.create({
      data: {
        userId: order.userId,
        delta: order.credits,
        type: CreditLedgerType.GRANT,
        reason: 'razorpay_payment_captured',
        razorpayPaymentId,
        metadata: {
          razorpayOrderId,
          orderRowId: order.id,
        },
      },
    });

    applied = true;
  });

  return applied;
}
