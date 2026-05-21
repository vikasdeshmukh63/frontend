'use client';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BellIcon } from 'lucide-react';
import { useTRPC } from '@/trpc/client';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { isProjectNotificationMessage } from '@/modules/projects/lib/message-notifications';

interface Props {
  projectId: string;
}

export function ProjectNotificationsButton({ projectId }: Props) {
  const trpc = useTRPC();
  const { data: chatPayload } = useQuery(
    trpc.messages.getMany.queryOptions(
      { projectId },
      { refetchInterval: 5000 }
    )
  );

  const messages = chatPayload?.messages ?? [];
  const notifications = messages.filter(isProjectNotificationMessage);
  const unreadCount = notifications.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="icon" variant="outline" className="relative h-8 w-8">
          <BellIcon className="size-4" />
          {unreadCount > 0 && (
            <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-90 p-0">
        <PopoverHeader className="border-b px-3 py-2">
          <PopoverTitle>Project Notifications</PopoverTitle>
        </PopoverHeader>
        <ScrollArea className="max-h-72">
          {notifications.length === 0 ? (
            <p className="text-muted-foreground px-3 py-4 text-sm">No notifications yet.</p>
          ) : (
            <div className="flex flex-col">
              {[...notifications].reverse().map((message) => (
                <div key={message.id} className="border-b px-3 py-2 last:border-b-0">
                  <p className="text-sm">{message.content}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {format(message.createdAt, "HH:mm 'on' MMM dd, yyyy")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

