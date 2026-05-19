import 'server-only';

import { inngest } from '@/inngest/client';
import { createGenerationStatusMessage } from '@/inngest/generation-status';
import type { ReferenceImageInput } from '@/inngest/reference-images';
import { defaultGenerationProgress } from '@/lib/generation-progress';
import { releaseStaleGenerationLocks } from '@/lib/generation-lock';

export async function clearProjectGenerationStatus(projectId: string) {
  const { clearAllGenerationStatusMessages } = await import(
    '@/inngest/generation-status'
  );
  await clearAllGenerationStatusMessages(projectId);
}

export type CodeAgentReferenceImage = ReferenceImageInput;

export async function dispatchCodeAgentRun(params: {
  projectId: string;
  userId: string;
  value: string;
  newSession?: boolean;
  referenceImages?: CodeAgentReferenceImage[];
  /** Internal: set when draining the queue so we do not enqueue again. */
  fromQueue?: boolean;
}) {
  await releaseStaleGenerationLocks(params.projectId);
  await clearProjectGenerationStatus(params.projectId);

  const statusMessage = await createGenerationStatusMessage(
    params.projectId,
    defaultGenerationProgress('Starting your build…')
  );

  await inngest.send({
    name: 'code-agent/run',
    data: {
      value: params.value,
      projectId: params.projectId,
      userId: params.userId,
      newSession: params.newSession === true,
      referenceImages: params.referenceImages ?? [],
      generationStatusMessageId: statusMessage.id,
    },
  });
}
