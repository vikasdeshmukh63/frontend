import 'server-only';

import { prisma } from '@/lib/db';
import { GENERATION_STATUS_PREFIX } from '@/lib/generation-status';
import { finishGenerationSession } from '@/lib/code-agent-queue';

const DEFAULT_ABANDONED_STATUS_MS = 4 * 60 * 1000;

function abandonedStatusMs(): number {
  const raw = process.env.ABANDONED_GENERATION_STATUS_MS;
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 60_000) return n;
  }
  return DEFAULT_ABANDONED_STATUS_MS;
}

/** Assistant message that ends a generation (success or failure). */
export async function hasTerminalAssistantAfterLastUser(
  projectId: string
): Promise<boolean> {
  const lastUser = await prisma.message.findFirst({
    where: { projectId, role: 'USER' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (!lastUser) return false;

  const terminal = await prisma.message.findFirst({
    where: {
      projectId,
      role: 'ASSISTANT',
      createdAt: { gt: lastUser.createdAt },
      OR: [
        { type: 'ERROR' },
        { fragment: { isNot: null } },
        {
          type: 'RESULT',
          content: { not: { startsWith: GENERATION_STATUS_PREFIX } },
        },
      ],
    },
    select: { id: true },
  });

  return !!terminal;
}

const ABANDONED_GENERATION_MESSAGE =
  'This build stopped before a result was saved (the background job may have ended early). Please try again or use Regenerate on your last message.';

/**
 * Clears orphaned `[status]` rows when Inngest finished but never wrote a terminal
 * assistant message (common cause of infinite "Building…" in the UI).
 */
export async function reconcileAbandonedGenerationLock(
  projectId: string
): Promise<void> {
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
  if (ageMs < abandonedStatusMs()) return;

  await finishGenerationSession(projectId, statusRow.id);

  const stillNoTerminal = !(await hasTerminalAssistantAfterLastUser(projectId));
  if (stillNoTerminal) {
    await prisma.message.create({
      data: {
        projectId,
        content: ABANDONED_GENERATION_MESSAGE,
        role: 'ASSISTANT',
        type: 'ERROR',
      },
    });
  }
}

/**
 * Always clears status/queue locks when an Inngest handler exits; adds a terminal
 * ERROR if the run produced no assistant reply.
 */
export async function endGenerationSessionSafely(params: {
  projectId: string;
  statusMessageId?: string;
}): Promise<void> {
  const hadTerminal = await hasTerminalAssistantAfterLastUser(params.projectId);
  await finishGenerationSession(params.projectId, params.statusMessageId);

  if (!hadTerminal) {
    const nowHasTerminal = await hasTerminalAssistantAfterLastUser(
      params.projectId
    );
    if (!nowHasTerminal) {
      await prisma.message.create({
        data: {
          projectId: params.projectId,
          content: ABANDONED_GENERATION_MESSAGE,
          role: 'ASSISTANT',
          type: 'ERROR',
        },
      });
    }
  }
}
