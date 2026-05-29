import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import TextareaAutosize from 'react-textarea-autosize';
import z from 'zod';
import { Form, FormField } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowUp, Loader2Icon } from 'lucide-react';
import { useTRPC } from '@/trpc/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChatAiSettingsButton } from '@/components/chat/chat-ai-settings';
import { Usage } from './usage';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { isPersistedAttachmentId } from '@/lib/attachment-id';
import {
  ChatImageAttachments,
  type UploadedChatAttachment,
} from './chat-image-attachments';

interface Props {
  projectId: string;
  isGenerating?: boolean;
  prefillValue?: string | null;
  onPrefillConsumed?: () => void;
  onMessageSent?: () => void;
}

const formSchema = z.object({
  value: z.string().max(10000, { message: 'Value is too long' }),
});

export const MessageForm = ({
  projectId,
  isGenerating = false,
  prefillValue,
  onPrefillConsumed,
  onMessageSent,
}: Props) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const router = useRouter();

  const { data: usage } = useQuery(trpc.usage.status.queryOptions());

  const [attachments, setAttachments] = useState<UploadedChatAttachment[]>([]);
  const [imageUploading, setImageUploading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      value: '',
    },
  });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const v = (prefillValue ?? '').trim();
    if (!v) return;
    form.setValue('value', v, { shouldValidate: true, shouldDirty: true });
    setTimeout(() => textareaRef.current?.focus(), 0);
    onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillValue]);

  const createMessage = useMutation(
    trpc.messages.create.mutationOptions({
      onSuccess: async (data) => {
        form.reset();
        setAttachments([]);
        await queryClient.invalidateQueries(
          trpc.messages.getMany.queryOptions({ projectId })
        );
        void queryClient.invalidateQueries(
          trpc.messages.getQueue.queryOptions({ projectId })
        );
        queryClient.invalidateQueries(trpc.usage.status.queryOptions());
        onMessageSent?.();
        const row = data as { queued?: boolean; queuePosition?: number };
        if (row.queued && row.queuePosition) {
          toast.info(
            `Message queued (#${row.queuePosition}). It will run when the current build finishes.`
          );
        }
      },
      onError: (error) => {
        toast.error(error.message || 'Something went wrong');
        if (error.data?.code === 'TOO_MANY_REQUESTS') {
          router.push('/pricing');
        }
      },
    })
  );

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const text = values.value.trim();
    const attachmentIds = attachments
      .map((a) => a.id)
      .filter(isPersistedAttachmentId);

    if (!text && attachmentIds.length === 0) {
      toast.error('Enter a message or attach an image');
      return;
    }

    if (imageUploading) {
      toast.error('Wait for images to finish uploading');
      return;
    }

    await createMessage.mutateAsync({
      value: text,
      projectId,
      attachmentIds,
    });
  };

  const [isFocused, setIsFocused] = useState(false);
  const showUsage = !!usage;
  const isPending = createMessage.isPending;
  const hasContent =
    form.watch('value').trim().length > 0 ||
    attachments.some((a) => isPersistedAttachmentId(a.id));
  const isButtonDisabled = isPending || !hasContent || imageUploading;

  return (
    <Form {...form}>
      {showUsage && (
        <Usage
          points={usage.remainingPoints}
          msBeforeNext={usage.msBeforeNext}
          generationCost={usage.generationCost}
          usingOwnApiKey={usage.usingOwnApiKey}
        />
      )}
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn(
          'bg-sidebar dark:bg-sidebar relative rounded-xl border p-4 pt-1 transition-all',
          isFocused && 'shadow-xs',
          showUsage && 'rounded-t-none'
        )}
      >
        <ChatImageAttachments
          projectId={projectId}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          onUploadingChange={setImageUploading}
          disabled={isPending || imageUploading}
        />
        <FormField
          control={form.control}
          name="value"
          render={({ field }) => {
            return (
              <TextareaAutosize
                {...field}
                ref={(el) => {
                  field.ref(el);
                  textareaRef.current = el;
                }}
                disabled={false}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                minRows={2}
                maxRows={8}
                className="w-full resize-none border-none bg-transparent pt-4 outline-none"
                placeholder={
                  isGenerating
                    ? 'Send another message — it will be queued…'
                    : 'What would you like to build'
                }
                onKeyDown={(e) => {
                  if (e.key == 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    form.handleSubmit(onSubmit)(e);
                  }
                }}
              />
            );
          }}
        />
        <div className="flex flex-wrap items-end justify-between gap-x-2 gap-y-2 pt-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-x-3 gap-y-1">
            <ChatAiSettingsButton />
            <div className="text-muted-foreground font-mono text-[10px]">
              <kbd className="bg-muted text-muted-foreground pointer-events-none inline-flex h-5 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium select-none">
                <span>&#8984;</span>Enter
              </kbd>
              &nbsp;to submit
            </div>
          </div>
          <Button
            disabled={isButtonDisabled}
            className={cn(
              'size-8 rounded-full',
              isButtonDisabled && 'bg-muted-foreground border'
            )}
            type="submit"
          >
            {isPending ? <Loader2Icon className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </form>
    </Form>
  );
};