'use client';

import { Hint } from '@/components/hint';
import { Button } from '@/components/ui/button';
import { Fragment } from '@/generated/prisma/client';
import { useTRPC } from '@/trpc/client';
import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangleIcon,
  ExternalLinkIcon,
  RefreshCcwIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

interface Props {
  projectId: string;
  data: Fragment;
  /** Bump to reload iframe after live code edits sync to the sandbox. */
  refreshKey?: number;
  onSandboxUrlChange?: (url: string) => void;
}

type FrameState = 'loading' | 'ready' | 'error';

function previewSrc(
  sandboxUrl: string,
  fragmentId: string,
  refreshKey: number,
  frameKey: number
): string {
  const separator = sandboxUrl.includes('?') ? '&' : '?';
  return `${sandboxUrl}${separator}v=${encodeURIComponent(fragmentId)}&r=${refreshKey}&f=${frameKey}`;
}

export function FragmentWeb({
  projectId,
  data,
  refreshKey = 0,
  onSandboxUrlChange,
}: Props) {
  const trpc = useTRPC();
  const [frameKey, setFrameKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [frameState, setFrameState] = useState<FrameState>('loading');
  const [sandboxUrl, setSandboxUrl] = useState(data.sandboxUrl);
  const [warmError, setWarmError] = useState<string | null>(null);

  const warmPreview = useMutation(
    trpc.projects.warmPreview.mutationOptions({
      onSuccess: (result) => {
        setSandboxUrl(result.sandboxPreviewUrl);
        setWarmError(
          result.previewReady
            ? null
            : 'Preview is still compiling. Wait a moment and click Refresh again.'
        );
        onSandboxUrlChange?.(result.sandboxPreviewUrl);
        setFrameKey((k) => k + 1);
        setFrameState('loading');
      },
      onError: (e) => {
        setWarmError(e.message || 'Could not refresh preview sandbox');
      },
    })
  );

  useEffect(() => {
    setSandboxUrl(data.sandboxUrl);
    setFrameState('loading');
    setWarmError(null);
    setFrameKey((k) => k + 1);
  }, [data.id, data.sandboxUrl, refreshKey]);

  const iframeSrc = sandboxUrl
    ? previewSrc(sandboxUrl, data.id, refreshKey, frameKey)
    : '';

  const onRefresh = () => {
    setWarmError(null);
    setFrameState('loading');
    warmPreview.mutate({ id: projectId, forceRestart: true });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(sandboxUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const showLoadingOverlay =
    warmPreview.isPending || (Boolean(iframeSrc) && frameState === 'loading');

  const showEmptyState = !sandboxUrl && !warmPreview.isPending;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="bg-sidebar flex items-center gap-x-2 border-b p-2">
        <Hint text="Refresh preview sandbox" side="bottom">
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            disabled={warmPreview.isPending}
          >
            <RefreshCcwIcon />
          </Button>
        </Hint>
        <Hint text="Click to copy" side="bottom">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopy}
            className="flex-1 justify-start text-start font-normal"
            disabled={!sandboxUrl || copied}
          >
            <span className="truncate">
              {sandboxUrl || 'No preview URL yet'}
            </span>
          </Button>
        </Hint>
        <Hint text="Open in new tab" side="bottom" align="start">
          <Button
            size="sm"
            variant="outline"
            disabled={!sandboxUrl}
            onClick={() => {
              if (!sandboxUrl) return;
              window.open(
                previewSrc(sandboxUrl, data.id, refreshKey, frameKey),
                '_blank'
              );
            }}
          >
            <ExternalLinkIcon />
          </Button>
        </Hint>
      </div>

      <div className="relative h-full w-full bg-white">
        {iframeSrc ? (
          <iframe
            key={frameKey}
            className="h-full w-full bg-white"
            sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
            allow="clipboard-write"
            loading="eager"
            src={iframeSrc}
            onLoad={() => {
              setFrameState('ready');
              setWarmError(null);
            }}
            onError={() => setFrameState('error')}
          />
        ) : null}

        {showEmptyState && (
          <div className="bg-background text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
            <p className="text-sm">Preview URL is not available yet.</p>
            <Button size="sm" variant="default" onClick={onRefresh}>
              <RefreshCcwIcon className="size-4" /> Start preview
            </Button>
          </div>
        )}

        {showLoadingOverlay && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80 text-neutral-600 backdrop-blur-[1px]">
            <p className="text-sm">
              {warmPreview.isPending
                ? 'Syncing preview sandbox…'
                : 'Loading preview…'}
            </p>
            {!warmPreview.isPending && (
              <p className="max-w-xs text-center text-xs">
                First compile may take up to a minute inside the iframe.
              </p>
            )}
          </div>
        )}

        {frameState === 'error' && !warmPreview.isPending && (
          <div className="bg-background/90 absolute inset-0 flex items-center justify-center p-6">
            <div className="bg-card max-w-lg rounded-lg border p-4 text-sm">
              <p className="mb-2 flex items-center gap-2 font-medium">
                <AlertTriangleIcon className="size-4 text-amber-500" />
                Preview failed to load
              </p>
              <p className="text-muted-foreground mb-3">
                {warmError ??
                  'The dev server may still be compiling or has a build error. Click Refresh or open in a new tab.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="default" onClick={onRefresh}>
                  <RefreshCcwIcon className="size-4" /> Refresh preview
                </Button>
                {sandboxUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      window.open(
                        previewSrc(sandboxUrl, data.id, refreshKey, frameKey),
                        '_blank'
                      )
                    }
                  >
                    <ExternalLinkIcon className="size-4" /> Open in new tab
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {warmError && frameState === 'ready' && !warmPreview.isPending && (
          <div className="absolute bottom-2 left-2 right-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            {warmError}
          </div>
        )}
      </div>
    </div>
  );
}
