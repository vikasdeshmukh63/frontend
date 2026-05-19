import 'server-only';

import { buildAttachmentProxyUrl } from '@/lib/attachment-url';
import { prisma } from '@/lib/db';

export type AttachmentRecord = {
  id: string;
  storageKey: string;
  publicUrl: string;
  fileName: string;
  mimeType: string;
};

function toAttachmentRecord(
  row: {
    id: string;
    projectId: string;
    storageKey: string;
    publicUrl: string;
    fileName: string;
    mimeType: string;
  }
): AttachmentRecord {
  return {
    id: row.id,
    storageKey: row.storageKey,
    publicUrl: buildAttachmentProxyUrl(row.projectId, row.id),
    fileName: row.fileName,
    mimeType: row.mimeType,
  };
}

export async function linkAttachmentsToMessage(
  attachmentIds: string[],
  messageId: string,
  projectId: string,
  userId: string
): Promise<AttachmentRecord[]> {
  if (attachmentIds.length === 0) return [];

  const uniqueIds = [...new Set(attachmentIds)];

  const rows = await prisma.messageAttachment.findMany({
    where: {
      id: { in: uniqueIds },
      projectId,
      userId,
      messageId: null,
    },
  });

  if (rows.length !== uniqueIds.length) {
    throw new Error('One or more attachments are invalid or already used.');
  }

  await prisma.messageAttachment.updateMany({
    where: { id: { in: uniqueIds } },
    data: { messageId },
  });

  return rows.map((r) => toAttachmentRecord(r));
}

export async function loadAttachmentsForMessage(
  messageId: string
): Promise<AttachmentRecord[]> {
  const rows = await prisma.messageAttachment.findMany({
    where: { messageId },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((r) => toAttachmentRecord(r));
}

export async function loadLatestUserMessageAttachments(
  projectId: string
): Promise<AttachmentRecord[]> {
  const latestUser = await prisma.message.findFirst({
    where: { projectId, role: 'USER' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (!latestUser) return [];
  return loadAttachmentsForMessage(latestUser.id);
}
