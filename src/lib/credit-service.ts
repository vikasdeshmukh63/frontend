import { CreditLedgerType, Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';

export const GENERATION_COST = 2;
/** Free credits on signup (must always be recorded in CreditLedger). */
export const STARTER_CREDITS = 5;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}

export class InsufficientCreditsError extends Error {
  constructor() {
    super('INSUFFICIENT_CREDITS');
    this.name = 'InsufficientCreditsError';
  }
}

type ConsumeCreditsParams = {
  amount: number;
  reason?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
};

export async function ensureCreditBalanceRow(userId: string) {
  await prisma.creditBalance.upsert({
    where: { userId },
    create: { userId, balance: 0 },
    update: {},
  });
}

/** Grant credits (e.g. successful payment). */
export async function grantCredits(params: {
  userId: string;
  amount: number;
  razorpayPaymentId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}) {
  const { userId, amount, razorpayPaymentId, reason, metadata } = params;
  if (amount <= 0) throw new Error('grant amount must be positive');

  await prisma.$transaction(async (tx) => {
    await tx.creditBalance.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
    });
    await tx.creditBalance.update({
      where: { userId },
      data: { balance: { increment: amount } },
    });
    await tx.creditLedger.create({
      data: {
        userId,
        delta: amount,
        type: CreditLedgerType.GRANT,
        reason: reason ?? 'credit_grant',
        razorpayPaymentId: razorpayPaymentId ?? null,
        metadata: metadata ? (metadata as object) : undefined,
      },
    });
  });
}

/** Reverse credits after a refund (delta stored as negative in ledger). */
export async function reverseCreditsForRefund(params: {
  userId: string;
  creditsToReverse: number;
  razorpayPaymentId?: string;
  reason?: string;
}) {
  const { userId, creditsToReverse, razorpayPaymentId, reason } = params;
  if (creditsToReverse <= 0) throw new Error('reverse amount must be positive');

  await prisma.$transaction(async (tx) => {
    await tx.creditBalance.upsert({
      where: { userId },
      create: { userId, balance: 0 },
      update: {},
    });
    const row = await tx.creditBalance.findUnique({ where: { userId } });
    const current = row?.balance ?? 0;
    const next = Math.max(0, current - creditsToReverse);
    const actualReversed = current - next;

    await tx.creditBalance.update({
      where: { userId },
      data: { balance: next },
    });

    await tx.creditLedger.create({
      data: {
        userId,
        delta: -actualReversed,
        type: CreditLedgerType.REFUND_REVERSAL,
        reason: reason ?? 'refund_reversal',
        razorpayPaymentId: razorpayPaymentId ?? null,
      },
    });
  });
}

/** Consume credits for a generation; throws if insufficient. Debit + ledger are atomic. */
export async function consumeCredits(userId: string) {
  return consumeCreditsAmount(userId, {
    amount: GENERATION_COST,
    reason: 'generation',
  });
}

/** Consume an explicit credit amount with optional idempotency key. */
export async function consumeCreditsAmount(
  userId: string,
  params: ConsumeCreditsParams
) {
  const { amount, reason, correlationId, metadata } = params;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('consume amount must be a positive integer');
  }
  await ensureCreditBalanceRow(userId);

  await prisma.$transaction(async (tx) => {
    if (correlationId) {
      const existing = await tx.creditLedger.findUnique({
        where: { correlationId },
      });
      if (existing) return;
    }

    const debit = await tx.creditBalance.updateMany({
      where: {
        userId,
        balance: { gte: amount },
      },
      data: {
        balance: { decrement: amount },
      },
    });

    if (debit.count === 0) {
      const row = await tx.creditBalance.findUnique({ where: { userId } });
      const balance = row?.balance ?? 0;
      if (balance < amount) {
        throw new InsufficientCreditsError();
      }
      throw new Error('CREDIT_DEBIT_FAILED');
    }

    await tx.creditLedger.create({
      data: {
        userId,
        delta: -amount,
        type: CreditLedgerType.CONSUME,
        reason: reason ?? 'generation',
        correlationId: correlationId ?? null,
        metadata: metadata ? (metadata as object) : undefined,
      },
    });
  });
}

/**
 * Returns the authoritative balance from CreditLedger, aligns CreditBalance when drift is detected,
 * and backfills a ledger row for legacy users who only had a balance row.
 */
export async function getCreditBalance(userId: string): Promise<number> {
  await ensureCreditBalanceRow(userId);

  return prisma.$transaction(async (tx) => {
    const agg = await tx.creditLedger.aggregate({
      where: { userId },
      _sum: { delta: true },
    });
    const ledgerCount = await tx.creditLedger.count({ where: { userId } });
    const row = await tx.creditBalance.findUnique({ where: { userId } });
    const tableBalance = row?.balance ?? 0;
    const ledgerSum = Math.max(0, agg._sum.delta ?? 0);

    if (ledgerCount === 0 && tableBalance > 0) {
      try {
        await tx.creditLedger.create({
          data: {
            userId,
            delta: tableBalance,
            type: CreditLedgerType.ADJUSTMENT,
            reason: 'legacy_balance_backfill',
            correlationId: `legacy_opening:${userId}`,
          },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
      }
      const recalc = await tx.creditLedger.aggregate({
        where: { userId },
        _sum: { delta: true },
      });
      const net = Math.max(0, recalc._sum.delta ?? 0);
      if (net !== tableBalance) {
        await tx.creditBalance.update({
          where: { userId },
          data: { balance: net },
        });
      }
      return net;
    }

    if (ledgerSum !== tableBalance) {
      console.error('[credits] Balance row does not match ledger sum; correcting', {
        userId,
        tableBalance,
        ledgerSum,
      });
      await tx.creditBalance.update({
        where: { userId },
        data: { balance: ledgerSum },
      });
    }

    return ledgerSum;
  });
}

/**
 * Restore generation credits when the Inngest job permanently fails after retries.
 * Idempotent per `correlationId` so duplicate failure handlers cannot double-credit.
 */
export async function refundFailedGenerationCredits(params: {
  userId: string;
  chargeCorrelationId: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
}) {
  const { userId, metadata, correlationId, chargeCorrelationId } = params;
  if (!correlationId.trim()) {
    throw new Error('refundFailedGenerationCredits: correlationId is required');
  }
  if (!chargeCorrelationId.trim()) {
    throw new Error(
      'refundFailedGenerationCredits: chargeCorrelationId is required'
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const charged = await tx.creditLedger.findUnique({
        where: { correlationId: chargeCorrelationId },
      });
      const chargedAmount = charged?.delta ? Math.max(0, -charged.delta) : 0;
      if (!chargedAmount) return;

      await tx.creditBalance.upsert({
        where: { userId },
        create: { userId, balance: 0 },
        update: {},
      });
      await tx.creditBalance.update({
        where: { userId },
        data: { balance: { increment: chargedAmount } },
      });
      await tx.creditLedger.create({
        data: {
          userId,
          delta: chargedAmount,
          type: CreditLedgerType.ADJUSTMENT,
          reason: 'generation_failed_refund',
          correlationId,
          metadata: {
            ...(metadata ? (metadata as object) : {}),
            refundedChargeCorrelationId: chargeCorrelationId,
          },
        },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      console.warn(
        '[credits] Duplicate generation_failed_refund ignored',
        correlationId
      );
      return;
    }
    throw error;
  }
}
