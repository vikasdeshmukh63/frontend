import { useTRPC } from '@/trpc/client';
import { useSuspenseQuery } from '@tanstack/react-query';
import MessageCard from './message-card';
import { MessageForm } from './message-form';
import { useEffect, useRef, useState } from 'react';
import { Fragment } from '@/generated/prisma/client';
import { MessageLoading } from './message-loading';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isProjectNotificationMessage } from '@/modules/projects/lib/message-notifications';
import {
  findLatestFragmentMessage,
  isGenerationStatusMessage,
  isProjectActivelyGenerating,
} from '@/lib/generation-status';
import { QueueBanner } from './queue-banner';

interface Props {
  projectId: string;
  setActiveFragment: (fragment: Fragment | null) => void;
}

const MessagesContainer = ({ projectId, setActiveFragment }: Props) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastAssistantMessageIdRef = useRef<string | null>(null);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [prefillValue, setPrefillValue] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<string>('');
  const [revertingFragmentId, setRevertingFragmentId] = useState<string | null>(
    null
  );
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<
    string | null
  >(null);
  const { data: messages } = useSuspenseQuery(
    trpc.messages.getMany.queryOptions({ projectId })
  );
  const statusMessage = messages.find(isGenerationStatusMessage);
  const visibleMessages = messages.filter(
    (m) => !isProjectNotificationMessage(m) && !isGenerationStatusMessage(m)
  );


  useEffect(() => {
    const latestFragment = findLatestFragmentMessage(messages);
    if (
      latestFragment?.fragment &&
      latestFragment.id !== lastAssistantMessageIdRef.current
    ) {
      setActiveFragment(latestFragment.fragment);
      lastAssistantMessageIdRef.current = latestFragment.id;
      void queryClient.invalidateQueries(
        trpc.projects.getOne.queryOptions({ id: projectId })
      );
    }
  }, [messages, setActiveFragment, projectId, queryClient, trpc.projects.getOne]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const isGenerating = isProjectActivelyGenerating(messages, statusMessage);
  const statusContent = statusMessage?.content;
  const lastUserMessage = visibleMessages.findLast((m) => m.role === 'USER');
  const hasStatusRow = Boolean(statusMessage);

  const { data: queueData } = useQuery({
    ...trpc.messages.getQueue.queryOptions({ projectId }),
    refetchInterval: hasStatusRow || isGenerating ? 2000 : false,
  });
  const queueItems = queueData?.items ?? [];
  const serverRunActive = queueData?.isRunActive ?? false;
  const shouldPollMessages = isGenerating || hasStatusRow || serverRunActive;

  useEffect(() => {
    if (!shouldPollMessages) return;
    const id = window.setInterval(() => {
      void queryClient.invalidateQueries(
        trpc.messages.getMany.queryOptions({ projectId })
      );
      void queryClient.invalidateQueries(
        trpc.messages.getQueue.queryOptions({ projectId })
      );
    }, 1200);
    return () => window.clearInterval(id);
  }, [
    shouldPollMessages,
    projectId,
    queryClient,
    trpc.messages.getMany,
    trpc.messages.getQueue,
  ]);

  const revertMutation = useMutation(
    trpc.messages.revertToFragment.mutationOptions({
      onSuccess: (msg) => {
        queryClient.invalidateQueries(trpc.messages.getMany.queryOptions({ projectId }));
        if (msg.fragment) setActiveFragment(msg.fragment);
        toast.success('Reverted');
        setRevertingFragmentId(null);
      },
      onError: (error) => {
        toast.error(error.message || 'Revert failed');
        setRevertingFragmentId(null);
      },
    })
  );

  const editMutation = useMutation(
    trpc.messages.editUserMessage.mutationOptions({
      onSuccess: (data) => {
        queryClient.invalidateQueries(trpc.messages.getMany.queryOptions({ projectId }));
        queryClient.invalidateQueries(trpc.messages.getQueue.queryOptions({ projectId }));
        setEditingMessageId(null);
        setEditingDraft('');
        const row = data as { queued?: boolean; queuePosition?: number };
        if (row.queued && row.queuePosition) {
          toast.info(
            `Edit queued (#${row.queuePosition}). It will run when the current build finishes.`
          );
        } else {
          toast.success('Updated. Regenerating…');
        }
      },
      onError: (error) => toast.error(error.message || 'Edit failed'),
    })
  );

  const regenerateMutation = useMutation(
    trpc.messages.regenerateResponse.mutationOptions({
      onSuccess: (data) => {
        queryClient.invalidateQueries(trpc.messages.getMany.queryOptions({ projectId }));
        queryClient.invalidateQueries(trpc.messages.getQueue.queryOptions({ projectId }));
        setRegeneratingMessageId(null);
        if (data.queued && data.queuePosition) {
          toast.info(
            `Regenerate queued (#${data.queuePosition}). It will run when the current build finishes.`
          );
        } else {
          toast.success('Regenerating…');
        }
      },
      onError: (error) => {
        toast.error(error.message || 'Regenerate failed');
        setRegeneratingMessageId(null);
      },
    })
  );

  const handleRegenerateFromUser = (userMessageId: string) => {
    if (regenerateMutation.isPending) return;
    setRegeneratingMessageId(userMessageId);
    regenerateMutation.mutate({ projectId, userMessageId });
  };

  const handleRegenerateFromError = (assistantMessageId: string) => {
    if (regenerateMutation.isPending) return;
    setRegeneratingMessageId(assistantMessageId);
    regenerateMutation.mutate({ projectId, assistantMessageId });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="pt-2 pr-1">
          {visibleMessages.map((message) => {
            return (
              <MessageCard
                key={message.id}
                projectId={projectId}
                content={message.content}
                role={message.role}
                attachments={message.attachments}
                fragment={message.fragment}
                editedFromContent={message.editedFrom?.content ?? null}
                createdAt={message.createdAt}
                type={message.type}
                isEditing={editingMessageId === message.id}
                editingDraft={editingMessageId === message.id ? editingDraft : ''}
                onEditingDraftChange={(v) => setEditingDraft(v)}
                isReverting={
                  revertMutation.isPending &&
                  !!message.fragment &&
                  revertingFragmentId === message.fragment.id
                }
                isSavingEdit={
                  editMutation.isPending && editingMessageId === message.id
                }
                onCopy={() => {
                  navigator.clipboard.writeText(message.content);
                  toast.success('Copied');
                }}
                onEdit={() => {
                  setEditingMessageId(message.id);
                  setEditingDraft(message.content);
                }}
                onCancelEdit={() => {
                  setEditingMessageId(null);
                  setEditingDraft('');
                }}
                onSaveEdit={() => {
                  if (message.role !== 'USER') return;
                  editMutation.mutate({
                    projectId,
                    messageId: message.id,
                    value: editingDraft,
                  });
                }}
                onRevertEditToPrevious={() => {
                  const prev = message.editedFrom?.content ?? '';
                  if (prev) setEditingDraft(prev);
                }}
                onRevert={() => {
                  if (!message.fragment) return;
                  setRevertingFragmentId(message.fragment.id);
                  revertMutation.mutate({
                    projectId,
                    fragmentId: message.fragment.id,
                  });
                }}
                canRegenerate={
                  message.role === 'ASSISTANT' && message.type === 'ERROR'
                }
                onRegenerate={() => handleRegenerateFromError(message.id)}
                isRegenerating={
                  regenerateMutation.isPending &&
                  regeneratingMessageId === message.id
                }
              />
            );
          })}
          {isGenerating && (
            <MessageLoading
              statusContent={statusContent}
              onRegenerate={
                lastUserMessage
                  ? () => handleRegenerateFromUser(lastUserMessage.id)
                  : undefined
              }
              isRegenerating={regenerateMutation.isPending}
            />
          )}
          <div ref={bottomRef} /> {/* Dummy div to scroll into view */}
        </div>
      </div>
      <div className="relative p-3 pt-1">
        <div className="from transparent to-background pointer-events-none absolute -top-6 right-0 left-0 h-6 bg-linear-to-b"></div>
        <QueueBanner items={queueItems} />
        <MessageForm
          projectId={projectId}
          isGenerating={isGenerating}
          prefillValue={prefillValue}
          onPrefillConsumed={() => setPrefillValue(null)}
        />
      </div>
    </div>
  );
};

export default MessagesContainer;
