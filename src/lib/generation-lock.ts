import 'server-only';

import { prisma } from '@/lib/db';
import { GENERATION_STATUS_PREFIX } from '@/lib/generation-status';

function staleGenerationMs(): number {
  const raw = process.env.STALE_GENERATION_LOCK_MS;
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 60_000) return n;
  }
  /** Longer than typical prepare + one LLM round; shorter than CODE_AGENT_RUN_TIMEOUT_MS. */
  return 12 * 60 * 1000;
}

/**
 * Run finished but [status] row or PROCESSING queue item was left behind — unblocks UI + queue.
 */
export async function clearOrphanedGenerationLocks(projectId: string): Promise<void> {
  const { clearAllGenerationStatusMessages } = await import(
    '@/inngest/generation-status'
  );

  const lastUser = await prisma.message.findFirst({
    where: { projectId, role: 'USER' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (!lastUser) return;

  const terminalAfterUser = await prisma.message.findFirst({
    where: {
      projectId,
      role: 'ASSISTANT',
      createdAt: { gt: lastUser.createdAt },
      OR: [
        { type: 'ERROR' },
        { fragment: { isNot: null } },
        { type: 'RESULT', content: { not: { startsWith: GENERATION_STATUS_PREFIX } } },
      ],
    },
    select: { id: true },
  });

  if (!terminalAfterUser) return;

  await clearAllGenerationStatusMessages(projectId);
  await prisma.codeAgentQueueItem.updateMany({
    where: { projectId, status: 'PROCESSING' },
    data: { status: 'COMPLETED', processedAt: new Date() },
  });
}

/**
 * Clears orphaned locks when Inngest restarts or a run dies without calling finishGenerationSession.
 */
export async function releaseStaleGenerationLocks(projectId: string): Promise<void> {
  await clearOrphanedGenerationLocks(projectId);

  const { clearAllGenerationStatusMessages } = await import(
    '@/inngest/generation-status'
  );
  const cutoff = new Date(Date.now() - staleGenerationMs());

  const staleStatus = await prisma.message.findFirst({
    where: {
      projectId,
      role: 'ASSISTANT',
      content: { startsWith: GENERATION_STATUS_PREFIX },
      updatedAt: { lt: cutoff },
    },
    select: { id: true },
  });

  if (staleStatus) {
    await clearAllGenerationStatusMessages(projectId);
  }

  await prisma.codeAgentQueueItem.updateMany({
    where: {
      projectId,
      status: 'PROCESSING',
      createdAt: { lt: cutoff },
    },
    data: { status: 'FAILED', processedAt: new Date() },
  });
}
