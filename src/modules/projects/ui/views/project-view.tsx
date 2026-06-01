'use client';

import { FileExplorer, type FileCollection } from '@/components/file-explorer';
import { Button } from '@/components/ui/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Fragment } from '@/generated/prisma/client';
import { CodeIcon, CrownIcon, EyeIcon } from 'lucide-react';
import Link from 'next/link';
import { Build01Logo } from '@/components/build01-logo';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FragmentWeb } from '../components/fragment-web';
import MessagesContainer from '../components/messages-container';
import { ProjectHeader } from '../components/project-header';
import UserControl from '@/components/user-control';
import { ErrorBoundary } from 'react-error-boundary';
import { useTRPC } from '@/trpc/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProjectNotificationsButton } from '../components/project-notifications-button';
import { toast } from 'sonner';

interface Props {
  projectId: string;
}

function stableStringifyFiles(files: FileCollection): string {
  const sorted = Object.keys(files)
    .sort()
    .reduce<Record<string, string>>((acc, k) => {
      acc[k] = files[k];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

function PreviewLoadingState({ label = 'Loading preview…' }: { label?: string }) {
  return (
    <div className="flex h-[calc(100vh-52px)] flex-col items-center justify-center gap-3 bg-black">
      <div className="relative flex items-center justify-center">
        <span className="absolute size-28 rounded-full border border-primary/60 animate-ping" />
        <span
          className="absolute size-40 rounded-full border border-primary/30 animate-ping"
          style={{ animationDelay: '350ms' }}
        />
        <div className="relative flex size-20 items-center justify-center rounded-full bg-black/80 shadow-[0_0_30px_rgba(59,130,246,0.35)]">
          <Build01Logo
            variant="mark"
            height={40}
            title="Build01 loading"
            className="animate-ping"
          />
        </div>
      </div>
      <p className="text-muted-foreground text-sm">{label}</p>
    </div>
  );
}

const ProjectView = ({ projectId }: Props) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: usage } = useQuery(trpc.usage.status.queryOptions());
  const genCost = usage?.generationCost ?? 2;
  const balance = usage?.remainingPoints ?? 0;
  const usingOwnApiKey = usage?.usingOwnApiKey ?? false;
  const needsCredits = !usingOwnApiKey && balance < genCost * 2;

  const [activeFragment, setActiveFragment] = useState<Fragment | null>(null);
  const [previewSyncing, setPreviewSyncing] = useState(false);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [tabState, setTabState] = useState<'preview' | 'code'>('preview');

  const activeFragmentIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeFragmentIdRef.current = activeFragment?.id ?? null;
  }, [activeFragment?.id]);

  const lastPreviewSyncPayloadRef = useRef('');
  const pendingSyncFilesRef = useRef<FileCollection | null>(null);

  useEffect(() => {
    lastPreviewSyncPayloadRef.current = '';
    pendingSyncFilesRef.current = null;
  }, [activeFragment?.id]);

  const explorerFiles = useMemo(
    () => (activeFragment?.files as FileCollection | undefined) ?? {},
    [activeFragment?.files, activeFragment?.id]
  );

  const saveFilesMutation = useMutation(
    trpc.messages.saveFragmentFiles.mutationOptions({
      onSuccess: async (data) => {
        setActiveFragment((prev) =>
          prev
            ? {
                ...prev,
                sandboxUrl: data.sandboxUrl,
                files: data.files as Fragment['files'],
              }
            : null
        );
        setPreviewRefreshKey((k) => k + 1);
        setEditorEpoch((e) => e + 1);
        lastPreviewSyncPayloadRef.current = stableStringifyFiles(
          data.files as FileCollection
        );
        // Avoid refetch storm + editor churn; local state + DB are already aligned.
        toast.success('Code saved');
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to save code');
      },
    })
  );

  const syncPreviewMutation = useMutation(
    trpc.messages.syncFragmentFiles.mutationOptions({
      onSuccess: (data) => {
        setActiveFragment((prev) =>
          prev ? { ...prev, sandboxUrl: data.sandboxUrl } : null
        );
        setPreviewRefreshKey((k) => k + 1);
      },
      onError: (error) => {
        toast.error(error.message || 'Failed to update preview');
      },
    })
  );

  const flushPreviewSync = useCallback(
    (files: FileCollection) => {
      const fid = activeFragmentIdRef.current;
      if (!fid) return;

      if (syncPreviewMutation.isPending) {
        pendingSyncFilesRef.current = files;
        return;
      }

      const payload = stableStringifyFiles(files);
      if (payload === lastPreviewSyncPayloadRef.current) return;

      syncPreviewMutation.mutate(
        { projectId, fragmentId: fid, files },
        {
          onSuccess: () => {
            lastPreviewSyncPayloadRef.current = payload;
          },
          onSettled: () => {
            const pending = pendingSyncFilesRef.current;
            pendingSyncFilesRef.current = null;
            if (pending) {
              const nextPayload = stableStringifyFiles(pending);
              if (nextPayload !== lastPreviewSyncPayloadRef.current) {
                flushPreviewSync(pending);
              }
            }
          },
        }
      );
    },
    [projectId, syncPreviewMutation]
  );

  const handlePreviewSync = flushPreviewSync;

  const handleSaveFiles = useCallback(
    (files: FileCollection) => {
      const fid = activeFragmentIdRef.current;
      if (!fid) return;
      saveFilesMutation.mutate({
        projectId,
        fragmentId: fid,
        files,
      });
    },
    [projectId, saveFilesMutation]
  );

  return (
    <div className="h-screen">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel
          defaultSize={35}
          minSize={20}
          className="flex min-h-0 flex-col"
        >
          <ErrorBoundary
            fallback={<p>Something went wrong loading the project header</p>}
          >
            <Suspense fallback={<p>Loading Project...</p>}>
              <ProjectHeader projectId={projectId} />
            </Suspense>
          </ErrorBoundary>
          <ErrorBoundary
            fallback={<p>Something went wrong loading the messages</p>}
          >
            <MessagesContainer
              projectId={projectId}
              setActiveFragment={setActiveFragment}
              onPreviewSyncingChange={setPreviewSyncing}
            />
          </ErrorBoundary>
        </ResizablePanel>
        <ResizableHandle className="hover:bg-primary transition-colors" />
        <ResizablePanel defaultSize={65} minSize={50}>
          <Tabs
            className="h-full gap-y-0"
            defaultValue="preview"
            value={tabState}
            onValueChange={(value) => setTabState(value as 'preview' | 'code')}
          >
            <div className="item-center flex w-full gap-x-2 border-b p-2">
              <TabsList className="h-8 rounded-md border p-0">
                <TabsTrigger value="preview" className="rounded-md">
                  <EyeIcon />
                  <span>Demo</span>
                </TabsTrigger>
                <TabsTrigger value="code" className="rounded-md">
                  <CodeIcon />
                  <span>Code</span>
                </TabsTrigger>
              </TabsList>
              <div className="item-center ml-auto flex gap-x-2">
                {needsCredits && (
                  <Button asChild size="sm" variant="tertiary">
                    <Link href="/pricing">
                      <CrownIcon /> Buy credits
                    </Link>
                  </Button>
                )}
                <ProjectNotificationsButton projectId={projectId} />
                <UserControl showName={false} />
              </div>
            </div>
            <TabsContent value="preview" className="mt-0">
              {previewSyncing ? (
                <PreviewLoadingState label="Reverting preview…" />
              ) : activeFragment ? (
                <FragmentWeb
                  projectId={projectId}
                  data={activeFragment}
                  refreshKey={previewRefreshKey}
                  onSandboxUrlChange={(url) => {
                    setActiveFragment((prev) =>
                      prev ? { ...prev, sandboxUrl: url } : null
                    );
                  }}
                />
              ) : (
                <PreviewLoadingState />
              )}
            </TabsContent>
            <TabsContent value="code" className="min-h-0 h-[calc(100vh-52px)]">
              {activeFragment && Object.keys(explorerFiles).length > 0 ? (
                <FileExplorer
                  key={`${activeFragment.id}-${editorEpoch}`}
                  fragmentId={activeFragment.id}
                  files={explorerFiles}
                  onPreviewSync={handlePreviewSync}
                  onSave={handleSaveFiles}
                  isSaving={saveFilesMutation.isPending}
                  isSyncingPreview={syncPreviewMutation.isPending}
                />
              ) : (
                <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                  Generate a project to view and edit code
                </div>
              )}
            </TabsContent>
          </Tabs>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default ProjectView;
