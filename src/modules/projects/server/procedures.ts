import { inngest } from '@/inngest/client';
import {
  loadInitialAgentFilesFromLatestFragment,
  refreshSandboxDevServer,
  resolveOrCreateSandboxId,
  syncSandboxFilesFromMap,
} from '@/inngest/project-sandbox';
import { ensureSandboxBootstrapFiles } from '@/inngest/sandbox-bootstrap';
import { prisma } from '@/lib/db';
import { toAppTrpcError } from '@/lib/prisma-errors';
import { protectedProcedure, createTRPCRouter } from '@/trpc/init';
import { TRPCError } from '@trpc/server';
import { Sandbox } from '@e2b/code-interpreter';
import { generateSlug } from 'random-word-slugs';
import z from 'zod';

export const projectsRouter = createTRPCRouter({
  getOne: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1, { message: 'Id is required' }),
      })
    )
    .query(async ({ input, ctx }) => {
      const existingProject = await prisma.project.findUnique({
        where: {
          id: input.id,
          userId: ctx.auth.userId,
        },
      });

      if (!existingProject) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        });
      }

      try {
        const previousSandboxId = existingProject.e2bSandboxId ?? null;
        const nextSandboxId = await resolveOrCreateSandboxId(existingProject.id);
        const sandboxWasRecreated = !previousSandboxId || previousSandboxId !== nextSandboxId;

        if (sandboxWasRecreated) {
          const latestFiles = await loadInitialAgentFilesFromLatestFragment(
            existingProject.id
          );
          await syncSandboxFilesFromMap(nextSandboxId, latestFiles);
        }

        const sandbox = await Sandbox.connect(nextSandboxId);
        await ensureSandboxBootstrapFiles(nextSandboxId);
        await refreshSandboxDevServer(nextSandboxId);
        const sandboxUrl = `https://${sandbox.getHost(3000)}`;

        await prisma.$transaction([
          prisma.project.update({
            where: { id: existingProject.id },
            data: { e2bSandboxId: nextSandboxId },
          }),
          prisma.fragment.updateMany({
            where: {
              message: {
                projectId: existingProject.id,
              },
            },
            data: { sandboxUrl },
          }),
        ]);

        return {
          ...existingProject,
          e2bSandboxId: nextSandboxId,
        };
      } catch (error) {
        console.error('Failed to revive project sandbox:', error);
        return existingProject;
      }
    }),
  getMany: protectedProcedure.query(async ({ ctx }) => {
    const projects = await prisma.project.findMany({
      where: { userId: ctx.auth.userId },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return projects;
  }),
  create: protectedProcedure
    .input(
      z.object({
        value: z
          .string()
          .min(1, { message: 'Value is required' })
          .max(10000, { message: 'Value is too long' }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const createdProject = await prisma.project.create({
          data: {
            userId: ctx.auth.userId,
            name: generateSlug(2, {
              format: 'kebab',
            }),
            messages: {
              create: {
                content: input.value,
                role: 'USER',
                type: 'RESULT',
              },
            },
          },
        });

        await inngest.send({
          name: 'code-agent/run',
          data: {
            value: input.value,
            projectId: createdProject.id,
            userId: ctx.auth.userId,
            newSession: true,
          },
        });

        return createdProject;
      } catch (error) {
        throw toAppTrpcError(error);
      }
    }),
});
