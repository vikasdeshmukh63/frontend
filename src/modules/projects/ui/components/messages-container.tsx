import { useTRPC } from '@/trpc/client';
import { useSuspenseQuery } from '@tanstack/react-query';
import MessageCard from './message-card';
import { MessageForm } from './message-form';
import { useEffect, useRef, useState } from 'react';
import { Fragment } from '@/generated/prisma/client';
import { MessageLoading } from './message-loading';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isProjectNotificationMessage } from '@/modules/projects/lib/message-notifications';

interface Props {
  projectId: string;
  activeFragment: Fragment | null;
  setActiveFragment: (fragment: Fragment | null) => void;
}

const MessagesContainer = ({
  projectId,
  activeFragment,
  setActiveFragment,
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
  const { data: messages } = useSuspenseQuery(
    trpc.messages.getMany.queryOptions(
      { projectId },
      // todo: temperory live message update
      { refetchInterval: 5000 }
    )
  );
  const visibleMessages = messages.filter((m) => !isProjectNotificationMessage(m));


  useEffect(() => {
   const lastAssistantMessage = messages.findLast(
    (message) => message.role === 'ASSISTANT'
   )

   if(lastAssistantMessage?.fragment && lastAssistantMessage.id !== lastAssistantMessageIdRef.current) {
    setActiveFragment(lastAssistantMessage.fragment)
    lastAssistantMessageIdRef.current = lastAssistantMessage.id
   }
  }, [messages, setActiveFragment]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const isLastMessageUser = lastMessage?.role === 'USER';

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
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.messages.getMany.queryOptions({ projectId }));
        setEditingMessageId(null);
        setEditingDraft('');
        toast.success('Updated. Regenerating…');
      },
      onError: (error) => toast.error(error.message || 'Edit failed'),
    })
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="pt-2 pr-1">
          {visibleMessages.map((message) => {
            return (
              <MessageCard
                key={message.id}
                messageId={message.id}
                content={message.content}
                role={message.role}
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
              />
            );
          })}
          {isLastMessageUser && <MessageLoading />}
          <div ref={bottomRef} /> {/* Dummy div to scroll into view */}
        </div>
      </div>
      <div className="relative p-3 pt-1">
        <div className="from transparent to-background pointer-events-none absolute -top-6 right-0 left-0 h-6 bg-linear-to-b"></div>
        <MessageForm
          projectId={projectId}
          prefillValue={prefillValue}
          onPrefillConsumed={() => setPrefillValue(null)}
        />
      </div>
    </div>
  );
};

export default MessagesContainer;
