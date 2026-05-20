'use client';

import Link from 'next/link';
import { Build01Logo } from '@/components/build01-logo';
import { useTheme } from 'next-themes';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { Button } from '@/components/ui/button';

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  PencilIcon,
  SunMoonIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ProjectDeleteDialog,
  ProjectRenameDialog,
} from '@/modules/projects/ui/components/project-actions';
import { useState } from 'react';

interface Props {
  projectId: string;
}

export const ProjectHeader = ({ projectId }: Props) => {
  const trpc = useTRPC();
  const { data: project } = useSuspenseQuery(
    trpc.projects.getOne.queryOptions({ id: projectId })
  );
  const { setTheme, theme } = useTheme();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <header className="flex items-center justify-between border-b p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="pl-2! transition-opacity hover:bg-transparent hover:opacity-75 focus-visible:ring-0"
            >
              <Build01Logo variant="mark" height={20} title="Build01" />
              <span className="text-sm font-medium">{project.name}</span>
              <ChevronDownIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start">
            <DropdownMenuItem asChild>
              <Link href="/">
                <ChevronLeftIcon />
                <span>Go to Dashboard</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <PencilIcon className="size-4" />
              <span>Rename project</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDeleteOpen(true)}
            >
              <Trash2Icon className="size-4" />
              <span>Delete project</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <SunMoonIcon className="text-muted-foreground size-4" />
                <span>Text Appearance</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                    <DropdownMenuRadioItem value="light">
                      <span>Light</span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      <span>Dark</span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">
                      <span>System</span>
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <ProjectRenameDialog
        projectId={projectId}
        projectName={project.name}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <ProjectDeleteDialog
        projectId={projectId}
        projectName={project.name}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        redirectAfterDelete="/"
      />
    </>
  );
};
