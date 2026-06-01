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
import { useCallback, useEffect, useState } from 'react';

interface Props {
  projectId: string;
  data: Fragment;
  /** Bump to reload iframe after live code edits sync to the sandbox. */
  refreshKey?: number;
  onSandboxUrlChange?: (url: string) => void;
}

type FrameState = 'loading' | 'ready' | 'error';

function previewSrc(sandboxUrl: string, fragmentId: string, refreshKey: number): string {
  const separator = sandboxUrl.includes('?') ? '&' : '?';
  return `${sandboxUrl}${separator}v=${encodeURIComponent(fragmentId)}&r=${refreshKey}`;
}

export function FragmentWeb({
  projectId,
  data,
  refreshKey = 0,
  onSandboxUrlChange,
}: Props) {
  const trpc = useTRPC();
  const [fragmentKey, setFragmentKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [frameState, setFrameState] = useState<FrameState>('loading');
  const [sandboxUrl, setSandboxUrl] = useState(data.sandboxUrl);
  const [previewReady, setPreviewReady] = useState(false);
  const [warmError, setWarmError] = useState<string | null>(null);

  const warmPreview = useMutation(
    trpc.projects.warmPreview.mutationOptions({
      onSuccess: (result) => {
        setSandboxUrl(result.sandboxPreviewUrl);
        setPreviewReady(result.previewReady);
        setWarmError(
          result.previewReady
            ? null
            : 'Preview sandbox is still starting. Try Refresh in a few seconds.'
        );
        onSandboxUrlChange?.(result.sandboxPreviewUrl);
        setFragmentKey((k) => k + 1);
      },
      onError: (e) => {
        setWarmError(e.message || 'Could not start preview sandbox');
        setPreviewReady(false);
      },
    })
  );

  const runWarmPreview = useCallback(() => {
    setWarmError(null);
    setFrameState('loading');
    setPreviewReady(false);
    warmPreview.mutate({ id: projectId });
  }, [projectId, warmPreview]);

  useEffect(() => {
    setSandboxUrl(data.sandboxUrl);
    runWarmPreview();
  }, [data.id, refreshKey, projectId]); // eslint-disable-line react-hooks/exhaustive-deps -- warm on fragment/sync change only

  const iframeSrc = sandboxUrl
    ? previewSrc(sandboxUrl, data.id, refreshKey)
    : '';

  const onRefresh = () => {
    runWarmPreview();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(sandboxUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const showErrorPanel = Boolean(warmError) || frameState === 'error';
  const showLoadingOverlay =
    !showErrorPanel &&
    (warmPreview.isPending || !previewReady || frameState === 'loading');

  return (
    <div className="flex h-full w-full flex-col">
      <div className="bg-sidebar flex items-center gap-x-2 border-b p-2">
        <Hint text="Refresh" side="bottom">
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
            <span className="truncate">{sandboxUrl}</span>
          </Button>
        </Hint>
        <Hint text="Open in new tab" side="bottom" align="start">
          <Button
            size="sm"
            variant="outline"
            disabled={!sandboxUrl}
            onClick={() => {
              if (!sandboxUrl) return;
              window.open(sandboxUrl, '_blank');
            }}
          >
            <ExternalLinkIcon />
          </Button>
        </Hint>
      </div>

      <div className="relative h-full w-full">
        {iframeSrc ? (
          <iframe
            key={fragmentKey}
            className="h-full w-full"
            sandbox="allow-forms allow-scripts allow-same-origin"
            allow="clipboard-write"
            loading="eager"
            src={iframeSrc}
            onLoad={() => {
              if (previewReady) setFrameState('ready');
            }}
            onError={() => setFrameState('error')}
          />
        ) : null}

        {showLoadingOverlay && (
          <div className="bg-background/80 text-muted-foreground absolute inset-0 flex flex-col items-center justify-center gap-2 backdrop-blur-[1px]">
            <p className="text-sm">
              {warmPreview.isPending
                ? 'Starting preview sandbox…'
                : 'Loading preview…'}
            </p>
            <p className="text-muted-foreground max-w-xs text-center text-xs">
              First load can take up to a minute while Next.js compiles.
            </p>
          </div>
        )}

        {showErrorPanel && !warmPreview.isPending && (
          <div className="bg-background/90 absolute inset-0 flex items-center justify-center p-6">
            <div className="bg-card max-w-lg rounded-lg border p-4 text-sm">
              <p className="mb-2 flex items-center gap-2 font-medium">
                <AlertTriangleIcon className="size-4 text-amber-500" />
                Preview not ready
              </p>
              <p className="text-muted-foreground mb-3">
                {warmError ??
                  'The dev server may still be compiling or has a build error. Click Refresh or open in a new tab.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="default" onClick={onRefresh}>
                  <RefreshCcwIcon className="size-4" /> Refresh preview
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => sandboxUrl && window.open(sandboxUrl, '_blank')}
                >
                  <ExternalLinkIcon className="size-4" /> Open in new tab
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
