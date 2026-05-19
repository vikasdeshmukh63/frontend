import 'server-only';

import type { CodeAgentQueueKind } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { GENERATION_STATUS_PREFIX } from '@/lib/generation-status';
import {
  dispatchCodeAgentRun,
  type CodeAgentReferenceImage,
} from '@/lib/code-agent-dispatch';
import { releaseStaleGenerationLocks } from '@/lib/generation-lock';

export type QueuePayload = {
  value: string;
  newSession?: boolean;
  referenceImages?: CodeAgentReferenceImage[];
  userMessageId?: string;
};

export async function isProjectGenerationBusy(
  projectId: string
): Promise<boolean> {
  await releaseStaleGenerationLocks(projectId);

  const statusRow = await prisma.message.findFirst({
    where: {
      projectId,
      role: 'ASSISTANT',
      content: { startsWith: GENERATION_STATUS_PREFIX },
    },
    select: { id: true },
  });
  if (statusRow) return true;

  const processing = await prisma.codeAgentQueueItem.findFirst({
    where: { projectId, status: 'PROCESSING' },
    select: { id: true },
  });
  return !!processing;
}

export async function countPendingQueueItems(projectId: string): Promise<number> {
  return prisma.codeAgentQueueItem.count({
    where: { projectId, status: 'PENDING' },
  });
}

export async function enqueueCodeAgentRun(params: {
  projectId: string;
  userId: string;
  kind: CodeAgentQueueKind;
  payload: QueuePayload;
}): Promise<{ queueItemId: string; position: number }> {
  const item = await prisma.codeAgentQueueItem.create({
    data: {
      projectId: params.projectId,
      userId: params.userId,
      kind: params.kind,
      status: 'PENDING',
      payload: params.payload,
    },
  });

  const position = await prisma.codeAgentQueueItem.count({
    where: { projectId: params.projectId, status: 'PENDING' },
  });

  return { queueItemId: item.id, position };
}

export async function tryDispatchCodeAgentRun(params: {
  projectId: string;
  userId: string;
  value: string;
  newSession?: boolean;
  referenceImages?: CodeAgentReferenceImage[];
}): Promise<{ started: true } | { started: false }> {
  if (await isProjectGenerationBusy(params.projectId)) {
    return { started: false };
  }

  await dispatchCodeAgentRun(params);
  return { started: true };
}

export async function processNextCodeAgentQueueItem(
  projectId: string
): Promise<boolean> {
  if (await isProjectGenerationBusy(projectId)) {
    return false;
  }

  const next = await prisma.codeAgentQueueItem.findFirst({
    where: { projectId, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });

  if (!next) return false;

  await prisma.codeAgentQueueItem.update({
    where: { id: next.id },
    data: { status: 'PROCESSING' },
  });

  const payload = next.payload as QueuePayload;

  try {
    await dispatchCodeAgentRun({
      projectId,
      userId: next.userId,
      value: payload.value,
      newSession: payload.newSession,
      referenceImages: payload.referenceImages,
    });
    return true;
  } catch (error) {
    await prisma.codeAgentQueueItem.update({
      where: { id: next.id },
      data: { status: 'FAILED', processedAt: new Date() },
    });
    console.error('[code-agent-queue] dispatch failed:', error);
    return processNextCodeAgentQueueItem(projectId);
  }
}

/** Call when an Inngest run finishes (success or error). */
export async function finishGenerationSession(
  projectId: string,
  statusMessageId?: string
): Promise<void> {
  const { deleteGenerationStatusMessage, clearAllGenerationStatusMessages } =
    await import('@/inngest/generation-status');
  await deleteGenerationStatusMessage(statusMessageId);
  await clearAllGenerationStatusMessages(projectId);

  await prisma.codeAgentQueueItem.updateMany({
    where: { projectId, status: 'PROCESSING' },
    data: { status: 'COMPLETED', processedAt: new Date() },
  });

  await processNextCodeAgentQueueItem(projectId);
}
