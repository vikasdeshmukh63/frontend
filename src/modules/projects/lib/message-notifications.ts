import { MessageRole, MessageType } from '@/generated/prisma/enums';

export function isProjectNotificationMessage(message: {
  role: MessageRole;
  type: MessageType;
  content: string;
}) {
  if (message.role !== 'ASSISTANT') return false;
  if (message.type !== 'RESULT') return false;

  return message.content.startsWith('Reverted to:');
}

