import { Button } from '@/components/ui/button';
import { CrownIcon } from 'lucide-react';
import Link from 'next/link';

interface Props {
  points: number;
  msBeforeNext: number;
  generationCost?: number;
  usingOwnApiKey?: boolean;
}

export const Usage = ({
  points,
  msBeforeNext,
  generationCost = 2,
  usingOwnApiKey = false,
}: Props) => {
  const lowBalance = !usingOwnApiKey && points < generationCost * 2;

  return (
    <div className="bg-background rounded-t-xl border border-b-0 p-2.5">
      <div className="flex items-center gap-x-2">
        <div>
          <p className="text-sm">{points} credits remaining</p>
          {msBeforeNext > 0 ? (
            <p className="text-muted-foreground text-xs">
              Rate-limit window active (legacy field).
            </p>
          ) : usingOwnApiKey ? (
            <p className="text-muted-foreground text-xs">
              Using your own API key, so app credits are not consumed.
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              Each message starts around {generationCost}+ credits (depends on model and prompt size).
            </p>
          )}
        </div>
        {lowBalance && (
          <Button asChild size="sm" variant="tertiary" className="ml-auto">
            <Link href="/pricing">
              <CrownIcon />
              Buy credits
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
};
