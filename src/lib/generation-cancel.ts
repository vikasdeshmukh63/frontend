import 'server-only';

import { inngest } from '@/inngest/client';
import { prisma } from '@/lib/db';

/**
 * Stops in-flight code-agent work for a project (used before revert, etc.).
 * Sends an Inngest cancel signal, clears UI status rows, and fails queued items
 * without starting the next queued run.
 */
export async function cancelActiveGenerationForProject(
  projectId: string
): Promise<void> {
  const { clearAllGenerationStatusMessages } = await import(
    '@/inngest/generation-status'
  );

  try {
    await inngest.send({
      name: 'code-agent/cancel',
      data: { projectId },
    });
  } catch (error) {
    console.warn('[generation-cancel] cancel event send failed:', error);
  }

  await clearAllGenerationStatusMessages(projectId);

  await prisma.codeAgentQueueItem.updateMany({
    where: {
      projectId,
      status: { in: ['PENDING', 'PROCESSING'] },
    },
    data: { status: 'FAILED', processedAt: new Date() },
  });
}
