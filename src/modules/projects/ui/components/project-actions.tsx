'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTRPC } from '@/trpc/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

function useProjectMutations(projectId: string, redirectAfterDelete?: string) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const invalidateProjects = () => {
    void queryClient.invalidateQueries(trpc.projects.getMany.queryOptions());
    void queryClient.invalidateQueries(
      trpc.projects.getOne.queryOptions({ id: projectId })
    );
  };

  const renameMutation = useMutation(
    trpc.projects.updateName.mutationOptions({
      onSuccess: () => {
        invalidateProjects();
        toast.success('Project renamed');
      },
      onError: (error) => toast.error(error.message || 'Could not rename project'),
    })
  );

  const deleteMutation = useMutation(
    trpc.projects.delete.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.projects.getMany.queryOptions());
        toast.success('Project deleted');
        if (redirectAfterDelete) {
          router.push(redirectAfterDelete);
        }
      },
      onError: (error) => toast.error(error.message || 'Could not delete project'),
    })
  );

  return { renameMutation, deleteMutation, invalidateProjects };
}

type RenameDialogProps = {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProjectRenameDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
}: RenameDialogProps) {
  const [nameDraft, setNameDraft] = useState(projectName);
  const { renameMutation } = useProjectMutations(projectId);

  useEffect(() => {
    if (open) setNameDraft(projectName);
  }, [open, projectName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = nameDraft.trim();
            if (!trimmed) {
              toast.error('Enter a project name');
              return;
            }
            renameMutation.mutate(
              { id: projectId, name: trimmed },
              { onSuccess: () => onOpenChange(false) }
            );
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`project-name-${projectId}`}>Name</Label>
            <Input
              id={`project-name-${projectId}`}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={80}
              autoFocus
              disabled={renameMutation.isPending}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={renameMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={renameMutation.isPending}>
              {renameMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DeleteDialogProps = {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  redirectAfterDelete?: string;
};

export function ProjectDeleteDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
  redirectAfterDelete,
}: DeleteDialogProps) {
  const { deleteMutation } = useProjectMutations(projectId, redirectAfterDelete);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this project?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes <strong>{projectName}</strong>, including all
            chat messages, code fragments, and queued builds. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={(e) => {
              e.preventDefault();
              deleteMutation.mutate(
                { id: projectId },
                { onSuccess: () => onOpenChange(false) }
              );
            }}
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type MenuProps = {
  projectId: string;
  projectName: string;
  redirectAfterDelete?: string;
  triggerClassName?: string;
};

export function ProjectActionsMenu({
  projectId,
  projectName,
  redirectAfterDelete,
  triggerClassName,
}: MenuProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={triggerClassName ?? 'size-8 shrink-0'}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <MoreHorizontalIcon className="size-4" />
            <span className="sr-only">Project options</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <PencilIcon className="size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setDeleteOpen(true)}
          >
            <Trash2Icon className="size-4" />
            Delete project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProjectRenameDialog
        projectId={projectId}
        projectName={projectName}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <ProjectDeleteDialog
        projectId={projectId}
        projectName={projectName}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        redirectAfterDelete={redirectAfterDelete}
      />
    </>
  );
}
