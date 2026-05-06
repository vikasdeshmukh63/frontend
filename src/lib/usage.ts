import { auth } from '@/auth';
import {
  getCreditBalance,
  InsufficientCreditsError,
} from '@/lib/credit-service';
import { MIN_DYNAMIC_GENERATION_CREDITS } from '@/lib/credit-pricing';

export { MIN_DYNAMIC_GENERATION_CREDITS as GENERATION_COST };

export async function consumeCreditsForUser(userId: string) {
  if (!userId) throw new Error('User not authenticated');
  // Credits are charged inside the Inngest function based on model and token estimates.
  // Keep this helper for compatibility in case other callers still import it.
  return;
}

export async function consumeCredits() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error('User not authenticated');

  await consumeCreditsForUser(userId);
}

export async function getUsageStatus() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error('User not authenticated');

  const balance = await getCreditBalance(userId);

  return {
    remainingPoints: balance,
    msBeforeNext: 0,
    generationCost: MIN_DYNAMIC_GENERATION_CREDITS,
  };
}

export function isInsufficientCreditsError(error: unknown): boolean {
  return error instanceof InsufficientCreditsError;
}
