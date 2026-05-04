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

interface Props {
  projectId: string;
}

const formSchema = z.object({
  value: z
    .string()
    .min(1, { message: 'Value is required' })
    .max(10000, { message: 'Value is too long' }),
});

export const MessageForm = ({ projectId }: Props) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const router = useRouter()

  const {data:usage} = useQuery(trpc.usage.status.queryOptions())

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      value: '',
    },
  });

  const createMessage = useMutation(
    trpc.messages.create.mutationOptions({
      onSuccess: () => {
        form.reset();
        queryClient.invalidateQueries(
          trpc.messages.getMany.queryOptions({ projectId })
        );
      queryClient.invalidateQueries(
        trpc.usage.status.queryOptions()
      )
      },
      onError: (error) => {
        toast.error(error.message || 'Something went wrong');
        if(error.data?.code === "TOO_MANY_REQUESTS"){
          router.push("/pricing")
        }
      },
    })
  );

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    await createMessage.mutateAsync({
      value: values.value,
      projectId,
    });
  };

  const [isFocused, setIsFocused] = useState(false);
  const showUsage = !!usage;
  const isPending = createMessage.isPending;
  const isButtonDisabled = isPending || !form.formState.isValid;

  return (
    <Form {...form}>
      {showUsage && <Usage points={usage.remainingPoints} msBeforeNext={usage.msBeforeNext}/>}
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn(
          'bg-sidebar dark:bg-sidebar relative rounded-xl border p-4 pt-1 transition-all',
          isFocused && 'shadow-xs',
          showUsage && 'rounded-t-none'
        )}
      >
        <FormField
          control={form.control}
          name="value"
          render={({ field }) => {
            return (
              <TextareaAutosize
                {...field}
                disabled={isPending}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                minRows={2}
                maxRows={8}
                className="w-full resize-none border-none bg-transparent pt-4 outline-none"
                placeholder="What would you like to build"
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
