import type {
  Fragment,
  Message,
  MessageAttachment,
} from '@/generated/prisma/client';
import { isAbandonedGenerationErrorContent } from '@/lib/generation-reconcile';
import {
  findLatestFragmentMessage,
  hasTerminalReplyAfterLastUser,
  isGenerationStatusMessage,
} from '@/lib/generation-status';
import { parseGenerationProgress, type GenerationProgress } from '@/lib/generation-progress';

export type ProjectMessageRow = Message & {
  fragment: Fragment | null;
  editedFrom: Pick<Message, 'content'> | null;
  attachments: Array<MessageAttachment & { publicUrl: string }>;
};

export type ProjectMessagesPayload = {
  messages: ProjectMessageRow[];
  /** True while Inngest is running (no terminal reply after latest user message). */
  isGenerating: boolean;
  /** Latest preview fragment for the demo panel (null while first build has no result). */
  latestFragment: Fragment | null;
  /** Live code progress while generating (parsed from status message). */
  generationProgress: GenerationProgress | null;
};

export function buildProjectMessagesPayload(
  rows: ProjectMessageRow[]
): ProjectMessagesPayload {
  const statusMessage = [...rows].reverse().find(isGenerationStatusMessage);
  const latest = findLatestFragmentMessage(rows);

  let messages = hasTerminalReplyAfterLastUser(rows)
    ? rows.filter((m) => !isGenerationStatusMessage(m))
    : rows;

  if (latest?.fragment) {
    messages = messages.filter(
      (m) =>
        !(
          m.role === 'ASSISTANT' &&
          m.type === 'ERROR' &&
          isAbandonedGenerationErrorContent(m.content)
        )
    );
  }

  const hasTerminal = hasTerminalReplyAfterLastUser(rows);
  const generationProgress = statusMessage
    ? parseGenerationProgress(statusMessage.content)
    : null;

  return {
    messages,
    isGenerating: Boolean(statusMessage) && !hasTerminal,
    latestFragment: latest?.fragment ?? null,
    generationProgress,
  };
}
