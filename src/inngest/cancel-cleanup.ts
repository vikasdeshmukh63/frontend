import { inngest } from '@/inngest/client';
import { clearAllGenerationStatusMessages } from '@/inngest/generation-status';
import { prisma } from '@/lib/db';

/**
 * Runs when `code-agent/cancel` is sent (e.g. revert). The main function may exit
 * without `finally`; this handler clears UI locks and fails in-flight queue rows.
 */
export const codeAgentCancelCleanup = inngest.createFunction(
  {
    id: 'code-agent-cancel-cleanup',
    triggers: [{ event: 'code-agent/cancel' }],
  },
  async ({ event }) => {
    const projectId =
      typeof event.data.projectId === 'string' ? event.data.projectId : undefined;
    if (!projectId) return;

    await clearAllGenerationStatusMessages(projectId);

    await prisma.codeAgentQueueItem.updateMany({
      where: {
        projectId,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
      data: { status: 'FAILED', processedAt: new Date() },
    });
  }
);
