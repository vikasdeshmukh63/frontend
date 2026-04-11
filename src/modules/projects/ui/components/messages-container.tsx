import { useTRPC } from '@/trpc/client';
import { useSuspenseQuery } from '@tanstack/react-query';
import MessageCard from './message-card';
import { MessageForm } from './message-form';
import { useEffect, useRef } from 'react';
import { Fragment } from '@/generated/prisma/client';
import { MessageLoading } from './message-loading';

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
  const { data: messages } = useSuspenseQuery(
    trpc.messages.getMany.queryOptions(
      { projectId },
      // todo: temperory live message update
      { refetchInterval: 5000 }
    )
  );


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

  const lastMessage = messages[messages.length - 1];
  const isLastMessageUser = lastMessage?.role === 'USER';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="pt-2 pr-1">
          {messages.map((message) => {
            return (
              <MessageCard
                key={message.id}
                content={message.content}
                role={message.role}
                fragment={message.fragment}
                createdAt={message.createdAt}
                isActiveFragment={activeFragment?.id === message.fragment?.id}
                onFragmentClick={() => setActiveFragment(message.fragment)}
                type={message.type}
              />
            );
          })}
          {isLastMessageUser && <MessageLoading />}
          <div ref={bottomRef} /> {/* Dummy div to scroll into view */}
        </div>
      </div>
      <div className="relative p-3 pt-1">
        <div className="from transparent to-background pointer-events-none absolute -top-6 right-0 left-0 h-6 bg-gradient-to-b"></div>
        <MessageForm projectId={projectId} />
      </div>
    </div>
  );
};

export default MessagesContainer;
