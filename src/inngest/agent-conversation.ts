import type { Message } from '@inngest/agent-kit';

import { buildAttachmentPublicUrl } from '@/lib/object-storage';
import { boundMessagesForRateLimit } from '@/lib/ai-rate-limit';
import { prisma } from '@/lib/db';
import type { ReferenceImageInput } from '@/inngest/reference-images';
import { referenceImagePublicUrls } from '@/inngest/reference-images';

function truncateForAgentContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated]`;
}

/** Loaded outside Inngest steps so `prepare-agent-session` step output stays small. */
export async function loadAgentConversationMessages(params: {
  projectId: string;
  referenceImages: ReferenceImageInput[];
  referenceImagePublicUrlsList: string[];
}): Promise<Message[]> {
  const formattedMessages: Message[] = [];
  const messages = await prisma.message.findMany({
    where: { projectId: params.projectId },
    orderBy: { createdAt: 'desc' },
    take: 8,
    include: {
      attachments: { orderBy: { createdAt: 'asc' } },
    },
  });

  for (const message of messages) {
    let content = message.content;
    if (message.role === 'ASSISTANT' && content.length > 1_200) {
      content = truncateForAgentContext(content, 1_200);
    }
    if (message.role === 'USER' && message.attachments.length > 0) {
      const lines = message.attachments.map((a) => {
        const idx = params.referenceImages.findIndex(
          (r) => r.storageKey === a.storageKey
        );
        const url =
          idx >= 0
            ? params.referenceImagePublicUrlsList[idx]
            : a.storageKey
              ? buildAttachmentPublicUrl(a.storageKey)
              : undefined;
        return url
          ? `- ${a.fileName}: use <img src="${url}" /> (public URL for sandbox)`
          : `- ${a.fileName}: see <reference_images>`;
      });
      content += `\n\n[Attached reference images]\n${lines.join('\n')}`;
    }
    formattedMessages.push({
      type: 'text',
      role: message.role === 'ASSISTANT' ? 'assistant' : 'user',
      content,
    });
  }

  return boundMessagesForRateLimit(formattedMessages.reverse());
}
