import {
  parseGenerationProgress,
  type GenerationStep,
} from '@/lib/generation-progress';
import { parseGenerationStatusHeadline } from '@/lib/generation-status';
import { Build01Logo } from '@/components/build01-logo';
import { CheckCircle2Icon, Loader2Icon } from 'lucide-react';

function GenerationStepsList({ steps }: { steps: GenerationStep[] }) {
  if (steps.length === 0) return null;

  return (
    <div className="border-border/60 rounded-md border bg-muted/30 px-3 py-2.5">
      <ul className="flex flex-col gap-2">
        {steps.map((step) => (
          <li
            key={step.id}
            className="flex items-start gap-2.5 text-sm leading-snug"
          >
            {step.status === 'running' ? (
              <Loader2Icon className="text-primary mt-0.5 size-4 shrink-0 animate-spin" />
            ) : (
              <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            )}
            <span
              className={
                step.status === 'running'
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground'
              }
            >
              {step.label}
            </span>
          </li>
        ))}
      </ul>
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
    ? (progress?.headline ?? parseGenerationStatusHeadline(statusContent))
    : 'Generating your app…';
  const steps = progress?.steps ?? [];

  return (
    <div className="group flex flex-col px-2 pb-4">
      <div className="mb-2 flex items-center gap-2 pl-2">
        <Build01Logo variant="mark" height={18} className="shrink-0" />
        <span className="text-sm font-medium">Build01</span>
        <Loader2Icon className="text-muted-foreground size-3.5 animate-spin" />
      </div>
      <div className="flex min-w-0 flex-col gap-y-3 pl-8.5">
        <p className="text-foreground text-sm font-medium">{headline}</p>

        {steps.length > 0 ? (
          <GenerationStepsList steps={steps} />
        ) : (
          <p className="text-muted-foreground text-sm">
            Waiting for the first step…
          </p>
        )}
      </div>
    </div>
  );
};
