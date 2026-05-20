'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Fragment } from '@/generated/prisma/client';
import { MessageRole, MessageType } from '@/generated/prisma/enums';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import {
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  XIcon,
} from 'lucide-react';
import { Build01Logo } from '@/components/build01-logo';
import { ChatAttachmentImage } from './chat-attachment-image';
import TextareaAutosize from 'react-textarea-autosize';
import { useEffect, useState } from 'react';

type MessageAttachmentView = {
  id: string;
  publicUrl: string;
  fileName: string;
  mimeType: string;
};

interface UserMessageProps {
  projectId: string;
  content: string;
  attachments?: MessageAttachmentView[];
  onCopy: () => void;
  onEdit: () => void;
  isEditing: boolean;
  editingDraft: string;
  onEditingDraftChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  canRevertEditToPrevious: boolean;
  onRevertEditToPrevious: () => void;
  isSavingEdit: boolean;
}

const UserMessage = ({
  projectId,
  content,
  attachments = [],
  onCopy,
  onEdit,
  isEditing,
  editingDraft,
  onEditingDraftChange,
  onCancelEdit,
  onSaveEdit,
  canRevertEditToPrevious,
  onRevertEditToPrevious,
  isSavingEdit,
}: UserMessageProps) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 900);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="group flex justify-end pr-2 pb-4 pl-10">
      <div className="flex max-w-[80%] flex-col items-end gap-1">
        <Card className="bg-muted w-full rounded-lg border-none p-3 shadow-none">
          {isEditing ? (
            <TextareaAutosize
              value={editingDraft}
              onChange={(e) => onEditingDraftChange(e.target.value)}
              minRows={2}
              maxRows={8}
              className="w-full resize-none border-none bg-transparent outline-none"
            />
          ) : (
            <>
              <span className="wrap-break-word">{content}</span>
              {attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {attachments.map((att) => (
                    <a
                      key={att.id}
                      href={att.publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="bg-background relative block size-20 overflow-hidden rounded-md border"
                    >
                      <ChatAttachmentImage
                        projectId={projectId}
                        attachmentId={att.id}
                        fileName={att.fileName}
                        imageUrl={att.publicUrl}
                      />
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => {
              onCopy();
              setCopied(true);
            }}
          >
            {copied ? (
              <CheckIcon className="size-4" />
            ) : (
              <CopyIcon className="size-4" />
            )}
          </Button>
          {isEditing ? (
            <>
              {canRevertEditToPrevious && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={onRevertEditToPrevious}
                  disabled={isSavingEdit}
                >
                  Revert
                </Button>
              )}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={onCancelEdit}
                title="Cancel"
                disabled={isSavingEdit}
              >
                <XIcon className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={onSaveEdit}
                title="Save & regenerate"
                disabled={isSavingEdit || !editingDraft.trim()}
              >
                {isSavingEdit ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <CheckIcon className="size-4" />
                )}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={onEdit}
              title="Edit in place"
              disabled={isSavingEdit}
            >
              <PencilIcon className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

interface AssistantMessageProps {
  content: string;
  fragment: Fragment | null;
  createdAt: Date;
  type: MessageType;
  onCopy: () => void;
  onRevert: () => void;
  isReverting: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
  isRegenerating: boolean;
}

const AssistantMessage = ({
  content,
  fragment,
  createdAt,
  type,
  onCopy,
  onRevert,
  isReverting,
  canRegenerate,
  onRegenerate,
  isRegenerating,
}: AssistantMessageProps) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 900);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div
      className={cn(
        'group flex flex-col px-2 pb-4',
        type === 'ERROR' && 'text-red-700 dark:text-red-500'
      )}
    >
      <div className="mb-2 flex items-center gap-2 pl-2">
        <Build01Logo variant="mark" height={18} className="shrink-0" />
        <span className="text-sm font-medium">Build01</span>
        <span className="text-muted-foreground text-xs opacity-0 transition-opacity group-hover:opacity-100">
          {format(createdAt, "HH:mm 'on' MMM dd, yyyy")}
        </span>
      </div>
      <div className="flex flex-col gap-y-4 pl-8.5">
        <span>{content}</span>
        <div className="flex flex-wrap items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
          {canRegenerate && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              onClick={onRegenerate}
              disabled={isRegenerating}
            >
              {isRegenerating ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-3.5" />
              )}
              Regenerate
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => {
              onCopy();
              setCopied(true);
            }}
          >
            {copied ? (
              <CheckIcon className="size-4" />
            ) : (
              <CopyIcon className="size-4" />
            )}
          </Button>
          {fragment && type === 'RESULT' && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={onRevert}
              title="Revert to this version"
              disabled={isReverting}
            >
              {isReverting ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <RotateCcwIcon className="size-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

interface MessageCardProps {
  projectId: string;
  content: string;
  role: MessageRole;
  attachments?: MessageAttachmentView[];
  fragment: Fragment | null;
  editedFromContent?: string | null;
  createdAt: Date;
  type: MessageType;
  isEditing: boolean;
  editingDraft: string;
  onEditingDraftChange: (value: string) => void;
  isReverting: boolean;
  isSavingEdit: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onRevertEditToPrevious: () => void;
  onRevert: () => void;
  canRegenerate: boolean;
  onRegenerate: () => void;
  isRegenerating: boolean;
}

const MessageCard = ({
  projectId,
  content,
  role,
  attachments,
  fragment,
  editedFromContent,
  createdAt,
  type,
  isEditing,
  editingDraft,
  onEditingDraftChange,
  isReverting,
  isSavingEdit,
  onCopy,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onRevertEditToPrevious,
  onRevert,
  canRegenerate,
  onRegenerate,
  isRegenerating,
}: MessageCardProps) => {
  if (role === 'ASSISTANT') {
    return (
      <AssistantMessage
        content={content}
        fragment={fragment}
        createdAt={createdAt}
        type={type}
        onCopy={onCopy}
        onRevert={onRevert}
        isReverting={isReverting}
        canRegenerate={canRegenerate}
        onRegenerate={onRegenerate}
        isRegenerating={isRegenerating}
      />
    );
  }

  return (
    <UserMessage
      projectId={projectId}
      content={content}
      attachments={attachments}
      onCopy={onCopy}
      onEdit={onEdit}
      isEditing={isEditing}
      editingDraft={editingDraft}
      onEditingDraftChange={onEditingDraftChange}
      onCancelEdit={onCancelEdit}
      onSaveEdit={onSaveEdit}
      canRevertEditToPrevious={!!editedFromContent}
      onRevertEditToPrevious={onRevertEditToPrevious}
      isSavingEdit={isSavingEdit}
    />
  );
};

export default MessageCard;
