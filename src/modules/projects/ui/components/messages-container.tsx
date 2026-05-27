import { useTRPC } from '@/trpc/client';
import MessageCard from './message-card';
import { MessageForm } from './message-form';
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import { Fragment } from '@/generated/prisma/client';
import { MessageLoading } from './message-loading';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isProjectNotificationMessage } from '@/modules/projects/lib/message-notifications';
import { isGenerationStatusMessage } from '@/lib/generation-status';
import { QueueBanner } from './queue-banner';

interface Props {
  projectId: string;
  setActiveFragment: Dispatch<SetStateAction<Fragment | null>>;
  onPreviewSyncingChange?: (syncing: boolean) => void;
}

const MessagesContainer = ({
  projectId,
  setActiveFragment,
  onPreviewSyncingChange,
}: Props) => {
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

  const messagesQuery = trpc.messages.getMany.queryOptions({ projectId });

  const { data: chatPayload, refetch: refetchChat } = useQuery({
    ...messagesQuery,
    refetchInterval: (query) =>
      query.state.data?.isGenerating ? 2_000 : false,
  });

  const messages = chatPayload?.messages ?? [];
  const showGenerationLoading = chatPayload?.isGenerating ?? false;
  const statusContent = [...messages]
    .reverse()
    .find(isGenerationStatusMessage)?.content;

  const visibleMessages = messages.filter(
    (m) => !isProjectNotificationMessage(m) && !isGenerationStatusMessage(m)
  );

  const { data: queueData } = useQuery({
    ...trpc.messages.getQueue.queryOptions({ projectId }),
    refetchInterval: showGenerationLoading ? 2_000 : false,
  });
  const queueItems = queueData?.items ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, showGenerationLoading]);

  const revertMutation = useMutation(
    trpc.messages.revertToFragment.mutationOptions({
      onMutate: async () => {
        onPreviewSyncingChange?.(true);
        await queryClient.cancelQueries(messagesQuery);
        const previous = queryClient.getQueryData(messagesQuery.queryKey);
        if (previous && typeof previous === 'object' && 'messages' in previous) {
          queryClient.setQueryData(messagesQuery.queryKey, {
            ...previous,
            isGenerating: false,
            messages: previous.messages.filter(
              (m) => !isGenerationStatusMessage(m)
            ),
          });
        }
        return { previous };
      },
      onSuccess: async (msg) => {
        await refetchChat();
        void queryClient.invalidateQueries(
          trpc.messages.getQueue.queryOptions({ projectId })
        );
        if (msg.fragment) {
          setActiveFragment(msg.fragment);
          lastAssistantMessageIdRef.current = msg.id;
        }
        toast.success('Reverted to the previous version');
        setRevertingFragmentId(null);
      },
      onError: (error, _vars, context) => {
        if (context?.previous) {
          queryClient.setQueryData(messagesQuery.queryKey, context.previous);
        }
        toast.error(error.message || 'Revert failed');
        setRevertingFragmentId(null);
      },
      onSettled: () => {
        onPreviewSyncingChange?.(false);
      },
    })
  );

  useEffect(() => {
    const fragment = chatPayload?.latestFragment;
    if (!fragment || revertMutation.isPending || revertingFragmentId) return;

    setActiveFragment((current) => {
      // Chat polls every few seconds; don't stomp in-progress code edits for the same fragment.
      if (current?.id === fragment.id) return current;
      return fragment;
    });
    const latestMsg = [...messages]
      .reverse()
      .find((m) => m.fragment?.id === fragment.id);
    if (latestMsg && latestMsg.id !== lastAssistantMessageIdRef.current) {
      lastAssistantMessageIdRef.current = latestMsg.id;
      void queryClient.invalidateQueries(
        trpc.projects.getOne.queryOptions({ id: projectId })
      );
    }
  }, [
    chatPayload?.latestFragment,
    messages,
    setActiveFragment,
    projectId,
    queryClient,
    trpc.projects.getOne,
    revertMutation.isPending,
    revertingFragmentId,
  ]);

  const editMutation = useMutation(
    trpc.messages.editUserMessage.mutationOptions({
      onSuccess: async (data) => {
        await refetchChat();
        void queryClient.invalidateQueries(
          trpc.messages.getQueue.queryOptions({ projectId })
        );
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
      onSuccess: async (data) => {
        await refetchChat();
        void queryClient.invalidateQueries(
          trpc.messages.getQueue.queryOptions({ projectId })
        );
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

  const handleRegenerateFromError = (assistantMessageId: string) => {
    if (regenerateMutation.isPending) return;
    setRegeneratingMessageId(assistantMessageId);
    regenerateMutation.mutate({ projectId, assistantMessageId });
  };

  if (chatPayload === undefined) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-6 text-sm">
        Loading messages…
      </div>
    );
  }

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
          {showGenerationLoading && (
            <MessageLoading statusContent={statusContent} />
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="relative p-3 pt-1">
        <div className="from transparent to-background pointer-events-none absolute -top-6 right-0 left-0 h-6 bg-linear-to-b"></div>
        <QueueBanner items={queueItems} />
        <MessageForm
          projectId={projectId}
          isGenerating={showGenerationLoading}
          prefillValue={prefillValue}
          onPrefillConsumed={() => setPrefillValue(null)}
          onMessageSent={() => void refetchChat()}
        />
      </div>
    </div>
  );
};

export default MessagesContainer;
