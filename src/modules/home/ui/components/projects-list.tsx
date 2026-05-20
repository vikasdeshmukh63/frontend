'use client';

import { Button } from '@/components/ui/button';
import { useTRPC } from '@/trpc/client';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Build01Logo } from '@/components/build01-logo';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ProjectActionsMenu } from '@/modules/projects/ui/components/project-actions';

export const ProjectsList = () => {
  const trpc = useTRPC();
  const { data: session, status } = useSession();
  const { data: projects } = useQuery(trpc.projects.getMany.queryOptions());

  if (status !== 'authenticated' || !session?.user) {
    return null;
  }

  const displayName =
    session.user.name ?? session.user.email?.split('@')[0] ?? 'Your';

  return (
    <div className="dark:bg-sidebar flex w-full flex-col gap-y-6 rounded-xl border bg-white p-8 sm:gap-y-4">
      <h2 className="text-2xl font-semibold">{displayName}&apos;s Vibes</h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {projects?.length === 0 && (
          <div className="col-span-full text-center">
            <p className="text-muted-foreground text-sm">No projects found.</p>
          </div>
        )}
        {projects?.map((project) => (
          <div
            key={project.id}
            className="border-input hover:bg-accent/50 flex items-center gap-1 rounded-md border p-1 transition-colors"
          >
            <Button
              variant="ghost"
              className="h-auto min-w-0 flex-1 justify-start p-3 text-start font-normal hover:bg-transparent"
              asChild
            >
              <Link href={`/projects/${project.id}`}>
                <div className="flex min-w-0 items-center gap-x-4">
                  <Build01Logo variant="mark" height={28} className="shrink-0" />
                  <div className="flex min-w-0 flex-col">
                    <h3 className="truncate font-medium">{project.name}</h3>
                    <p className="text-muted-foreground text-sm">
                      {formatDistanceToNow(project.updatedAt, {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </div>
              </Link>
            </Button>
            <ProjectActionsMenu
              projectId={project.id}
              projectName={project.name}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
