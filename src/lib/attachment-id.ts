import { z } from 'zod';

const uuidSchema = z.string().uuid();

/** True when the id is a saved MessageAttachment row (safe for tRPC attachmentIds). */
export function isPersistedAttachmentId(id: string): boolean {
  return uuidSchema.safeParse(id).success;
}
