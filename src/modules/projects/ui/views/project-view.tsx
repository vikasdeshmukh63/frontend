'use client';

import { FileExplorer } from '@/components/file-explorer';
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
import { Suspense, useState } from 'react';
import { FragmentWeb } from '../components/fragment-web';
import MessagesContainer from '../components/messages-container';
import { ProjectHeader } from '../components/project-header';
import UserControl from '@/components/user-control';
import { ErrorBoundary } from 'react-error-boundary';
import { useTRPC } from '@/trpc/client';
import { useQuery } from '@tanstack/react-query';
import { ProjectNotificationsButton } from '../components/project-notifications-button';

interface Props {
  projectId: string;
}


function PreviewLoadingState() {
  return (
    <div className="flex h-[calc(100vh-52px)] items-center justify-center bg-black">
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
    </div>
  );
}

const ProjectView = ({ projectId }: Props) => {
  const trpc = useTRPC();
  const { data: usage } = useQuery(trpc.usage.status.queryOptions());
  const genCost = usage?.generationCost ?? 2;
  const balance = usage?.remainingPoints ?? 0;
  const needsCredits = balance < genCost * 2;

  const [activeFragment, setActiveFragment] = useState<Fragment | null>(null);
  const [tabState, setTabState] = useState<'preview' | 'code'>('preview');

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
            <Suspense fallback={<p>Loading Messages...</p>}>
              <MessagesContainer
                projectId={projectId}
                setActiveFragment={setActiveFragment}
              />
            </Suspense>
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
              {activeFragment ? <FragmentWeb data={activeFragment} /> : <PreviewLoadingState />}
            </TabsContent>
            <TabsContent value="code" className="min-h-0">
              {!!activeFragment?.files && (
                <FileExplorer
                  files={activeFragment.files as { [path: string]: string }}
                />
              )}
            </TabsContent>
          </Tabs>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default ProjectView;
