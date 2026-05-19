/** Same-origin URL for chat attachment previews (proxied from S3 with auth). */
export function buildAttachmentProxyUrl(
  projectId: string,
  attachmentId: string
): string {
  return `/api/projects/${encodeURIComponent(projectId)}/attachments/${encodeURIComponent(attachmentId)}`;
}
