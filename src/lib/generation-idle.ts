import 'server-only';

import { prisma } from '@/lib/db';
import { GENERATION_STATUS_PREFIX } from '@/lib/generation-status';
import { hasTerminalAssistantAfterLastUser } from '@/lib/generation-reconcile';
import { finishGenerationSession } from '@/lib/code-agent-queue';

/** Status rows older than this are treated as orphaned (Inngest stopped without cleanup). */
export function generationStatusActiveWindowMs(): number {
  const raw = process.env.GENERATION_STATUS_ACTIVE_MS;
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 10_000) return n;
  }
  return 12_000;
}

/**
 * Clears `[status]` rows left behind when Inngest cancelled/failed without `finishGenerationSession`.
 * Safe to call on every `getMany` / `getQueue` poll.
 */
export async function reconcileIdleGenerationStatus(
  projectId: string,
  activeWindowMs?: number
): Promise<void> {
  const activeMs = activeWindowMs ?? generationStatusActiveWindowMs();
  const statusRow = await prisma.message.findFirst({
    where: {
      projectId,
      role: 'ASSISTANT',
      content: { startsWith: GENERATION_STATUS_PREFIX },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, updatedAt: true },
  });

  if (!statusRow) return;

  if (await hasTerminalAssistantAfterLastUser(projectId)) {
    await finishGenerationSession(projectId, statusRow.id);
    return;
  }

  const ageMs = Date.now() - statusRow.updatedAt.getTime();
  if (ageMs < activeMs) return;

  /** Read-path only: clear stale status, never insert a false ERROR during an active Inngest run. */
  await finishGenerationSession(projectId, statusRow.id);
}
