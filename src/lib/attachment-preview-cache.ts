/** In-memory blob URLs for attachments uploaded this session (fallback if proxy/S3 is slow). */

const previewByAttachmentId = new Map<string, string>();

export function cacheAttachmentPreview(attachmentId: string, blobUrl: string) {
  if (!blobUrl.startsWith('blob:')) return;
  previewByAttachmentId.set(attachmentId, blobUrl);
}

export function getCachedAttachmentPreview(
  attachmentId: string
): string | undefined {
  return previewByAttachmentId.get(attachmentId);
}

export function removeCachedAttachmentPreview(attachmentId: string) {
  previewByAttachmentId.delete(attachmentId);
}
