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
  RotateCcwIcon,
  XIcon,
} from 'lucide-react';
import Image from 'next/image';
import TextareaAutosize from 'react-textarea-autosize';
import { useEffect, useState } from 'react';

interface UserMessageProps {
  content: string;
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
  content,
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
            <span className="wrap-break-word">{content}</span>
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
}

const AssistantMessage = ({
  content,
  fragment,
  createdAt,
  type,
  onCopy,
  onRevert,
  isReverting,
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
        <Image
          src="/logo.svg"
          alt="Fingerchip Logo"
          width={18}
          height={18}
          className="shrink-0"
        />
        <span className="text-sm font-medium">Fingerchip</span>
        <span className="text-muted-foreground text-xs opacity-0 transition-opacity group-hover:opacity-100">
          {format(createdAt, "HH:mm 'on' MMM dd, yyyy")}
        </span>
      </div>
      <div className="flex flex-col gap-y-4 pl-8.5">
        <span>{content}</span>
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
  messageId: string;
  content: string;
  role: MessageRole;
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
}

const MessageCard = ({
  messageId: _messageId,
  content,
  role,
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
      />
    );
  }

  return (
    <UserMessage
      content={content}
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
