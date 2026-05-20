import { cn } from '@/lib/utils';
import {
  parseGenerationProgress,
  type GenerationProgress,
} from '@/lib/generation-progress';
import { parseGenerationStatusHeadline } from '@/lib/generation-status';
import { Build01Logo } from '@/components/build01-logo';
import { CheckCircle2Icon, CircleIcon, Loader2Icon } from 'lucide-react';

function BuildProgressTimeline({ progress }: { progress: GenerationProgress }) {
  const steps = progress.steps;
  const activeIndex = steps.findIndex((s) => s.status === 'running');

  return (
    <div className="flex flex-col gap-2">
      <p className="text-foreground text-sm font-medium">{progress.headline}</p>
      {steps.length > 0 ? (
        <ul className="border-border/60 flex max-h-48 flex-col gap-1 overflow-y-auto border-l pl-3">
          {steps.map((step, index) => {
            const isRunning = step.status === 'running';
            const isDone = step.status === 'done';
            return (
              <li
                key={step.id}
                className={cn(
                  'flex items-start gap-2 text-xs',
                  isRunning && 'text-foreground font-medium',
                  isDone && 'text-muted-foreground',
                  !isRunning && !isDone && 'text-muted-foreground'
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {isDone ? (
                    <CheckCircle2Icon className="text-primary size-3.5" />
                  ) : isRunning ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <CircleIcon className="size-3.5 opacity-40" />
                  )}
                </span>
                <span>{step.label}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-xs">Starting…</p>
      )}
      {activeIndex >= 0 && steps.length > 0 && (
        <p className="text-muted-foreground font-mono text-[10px]">
          Step {activeIndex + 1} of {steps.length}
        </p>
      )}
    </div>
  );
}

export const MessageLoading = ({
  statusContent,
}: {
  statusContent?: string;
}) => {
  const progress = statusContent
    ? parseGenerationProgress(statusContent)
    : null;
  const headline = statusContent
    ? progress?.headline ?? parseGenerationStatusHeadline(statusContent)
    : 'Building…';

  return (
    <div className="group flex flex-col px-2 pb-4">
      <div className="mb-2 flex items-center gap-2 pl-2">
        <Build01Logo variant="mark" height={18} className="shrink-0" />
        <span className="text-sm font-medium">Build01</span>
        <Loader2Icon className="text-muted-foreground size-3.5 animate-spin" />
      </div>
      <div className="flex flex-col gap-y-3 pl-8.5">
        {progress ? (
          <BuildProgressTimeline progress={progress} />
        ) : (
          <p className="text-muted-foreground animate-pulse text-sm">{headline}</p>
        )}
      </div>
    </div>
  );
};
