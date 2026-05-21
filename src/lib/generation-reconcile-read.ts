import 'server-only';

import { prisma } from '@/lib/db';
import { clearOrphanedGenerationLocks } from '@/lib/generation-lock';
import { reconcileIdleGenerationStatus } from '@/lib/generation-idle';
import {
  pruneSupersededAbandonedErrors,
  reconcileAbandonedGenerationLock,
} from '@/lib/generation-reconcile';

/** Status untouched this long during a poll ⇒ clear row only (no ERROR). */
const READ_IDLE_MS = 45_000;

/**
 * Lightweight reconcile for chat polls. Never invents ERROR rows — those are
 * only created from Inngest onFailure/finally when a run truly failed.
 */
export async function reconcileGenerationOnRead(projectId: string): Promise<void> {
  await clearOrphanedGenerationLocks(projectId);
  await reconcileIdleGenerationStatus(projectId, READ_IDLE_MS);
  await reconcileAbandonedGenerationLock(projectId, READ_IDLE_MS, {
    createErrorIfOrphaned: false,
  });
  await pruneSupersededAbandonedErrors(projectId);
}
