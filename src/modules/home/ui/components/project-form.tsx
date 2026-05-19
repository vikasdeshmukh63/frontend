'use client';

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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { PROJECT_TEMPLATES } from '../../constants';
import { ChatAiSettingsButton } from '@/components/chat/chat-ai-settings';

const formSchema = z.object({
  value: z
    .string()
    .min(1, { message: 'Value is required' })
    .max(10000, { message: 'Value is too long' }),
});

export const ProjectForm = () => {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      value: '',
    },
  });

  const createProject = useMutation(trpc.projects.create.mutationOptions());
  const createMessage = useMutation(trpc.messages.create.mutationOptions());

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const project = await createProject.mutateAsync({});
      await createMessage.mutateAsync({
        projectId: project.id,
        value: values.value,
        newSession: true,
      });
      queryClient.invalidateQueries(trpc.projects.getMany.queryOptions());
      queryClient.invalidateQueries(trpc.usage.status.queryOptions());
      form.reset();
      router.push(`/projects/${project.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Something went wrong'
      );
      if (
        error &&
        typeof error === 'object' &&
        'data' in error &&
        (error as { data?: { code?: string } }).data?.code === 'UNAUTHORIZED'
      ) {
        router.push('/sign-in');
      }
      if (
        error &&
        typeof error === 'object' &&
        'data' in error &&
        (error as { data?: { code?: string } }).data?.code === 'TOO_MANY_REQUESTS'
      ) {
        router.push('/pricing');
      }
    }
  };

  const onSelect = (value: string) => {
    form.setValue('value', value, {
      shouldDirty: true,
      shouldValidate: true,
      shouldTouch: true,
    });
  };

  const [isFocused, setIsFocused] = useState(false);
  const isPending = createProject.isPending || createMessage.isPending;
  const isButtonDisabled = isPending || !form.formState.isValid;

  return (
    <Form {...form}>
      <section className="space-y-6">
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className={cn(
            'bg-sidebar dark:bg-sidebar relative rounded-xl border p-4 pt-1 transition-all',
            isFocused && 'shadow-xs'
          )}
        >
          <FormField
            control={form.control}
            name="value"
            render={({ field }) => (
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
            )}
          />
          <div className="flex flex-wrap items-end justify-between gap-x-2 gap-y-2 pt-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-end gap-x-3 gap-y-1">
              <ChatAiSettingsButton />
              <p className="text-muted-foreground text-[10px]">
                Attach reference images inside the project chat
              </p>
            </div>
            <Button
              disabled={isButtonDisabled}
              className={cn(
                'size-8 rounded-full',
                isButtonDisabled && 'bg-muted-foreground border'
              )}
              type="submit"
            >
              {isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <ArrowUp />
              )}
            </Button>
          </div>
        </form>
        <div className="hidden max-w-3xl flex-wrap justify-center gap-2 md:flex">
          {PROJECT_TEMPLATES.map((template) => (
            <Button
              key={template.title}
              variant="outline"
              size="sm"
              className="dark:bg-sidebar bg-white"
              onClick={() => onSelect(template.prompt)}
            >
              {template.emoji} {template.title}
            </Button>
          ))}
        </div>
      </section>
    </Form>
  );
};
