import { Hint } from '@/components/hint';
import { Button } from '@/components/ui/button';
import { Fragment } from '@/generated/prisma/client';
import { AlertTriangleIcon, ExternalLinkIcon, RefreshCcwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Props {
  data: Fragment;
}

type FrameState = 'loading' | 'ready' | 'error';

export function FragmentWeb({ data }: Props) {
  const [fragmentKey, setFragmentKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [frameState, setFrameState] = useState<FrameState>('loading');

  useEffect(() => {
    // AI generations usually keep the same sandbox URL, so force iframe remount
    // whenever a new fragment record is selected.
    setFragmentKey((prev) => prev + 1);
  }, [data.id]);

  useEffect(() => {
    setFrameState('loading');
    const timeout = window.setTimeout(() => {
      setFrameState((current) => (current === 'ready' ? current : 'error'));
    }, 12000);

    return () => window.clearTimeout(timeout);
  }, [fragmentKey, data.sandboxUrl]);

  const onRefresh = () => {
    setFragmentKey((prev) => prev + 1);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(data.sandboxUrl);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="bg-sidebar flex items-center gap-x-2 border-b p-2">
        <Hint text="Refresh" side="bottom">
          <Button size="sm" variant="outline" onClick={onRefresh}>
            <RefreshCcwIcon />
          </Button>
        </Hint>
        <Hint text="Click to copy" side="bottom">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopy}
            className="flex-1 justify-start text-start font-normal"
            disabled={!data.sandboxUrl || copied}
          >
            <span className="truncate">{data.sandboxUrl}</span>
          </Button>
        </Hint>
        <Hint text="Open in new tab" side="bottom" align="start">
          <Button
            size="sm"
            variant="outline"
            disabled={!data.sandboxUrl}
            onClick={() => {
              if (!data.sandboxUrl) return;
              window.open(data.sandboxUrl, '_blank');
            }}
          >
            <ExternalLinkIcon />
          </Button>
        </Hint>
      </div>

      <div className="relative h-full w-full">
        <iframe
          key={fragmentKey}
          className="h-full w-full"
          sandbox="allow-forms allow-scripts allow-same-origin"
          loading="lazy"
          src={data.sandboxUrl}
          onLoad={() => setFrameState('ready')}
          onError={() => setFrameState('error')}
        />

        {frameState === 'loading' && (
          <div className="bg-background/60 text-muted-foreground absolute inset-0 flex items-center justify-center backdrop-blur-[1px]">
            <p className="text-sm">Loading preview...</p>
          </div>
        )}

        {frameState === 'error' && (
          <div className="bg-background/90 absolute inset-0 flex items-center justify-center p-6">
            <div className="bg-card max-w-lg rounded-lg border p-4 text-sm">
              <p className="mb-2 flex items-center gap-2 font-medium">
                <AlertTriangleIcon className="size-4 text-amber-500" />
                Preview failed to load
              </p>
              <p className="text-muted-foreground mb-3">
                The sandbox app may have a runtime/build error. Open it in a new tab to
                inspect the exact error output.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => data.sandboxUrl && window.open(data.sandboxUrl, '_blank')}
              >
                <ExternalLinkIcon /> Open sandbox logs
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
