import { inngest } from '@/inngest/client';
import { prisma } from '@/lib/db';
import { reviveProjectSandbox } from '@/lib/revive-project-sandbox';
import { toAppTrpcError } from '@/lib/prisma-errors';
import { protectedProcedure, createTRPCRouter } from '@/trpc/init';
import { TRPCError } from '@trpc/server';
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
        const revived = await reviveProjectSandbox(existingProject.id);
        return {
          ...existingProject,
          e2bSandboxId: revived.sandboxId,
          sandboxPreviewUrl: revived.sandboxPreviewUrl,
          previewReady: revived.previewReady,
        };
      } catch (error) {
        console.error('Failed to revive project sandbox:', error);
        return {
          ...existingProject,
          sandboxPreviewUrl: null as string | null,
          previewReady: false,
        };
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
  create: protectedProcedure.input(z.object({}).optional())
    .mutation(async ({ input, ctx }) => {
      try {
        const createdProject = await prisma.project.create({
          data: {
            userId: ctx.auth.userId,
            name: generateSlug(2, {
              format: 'kebab',
            }),
          },
        });

        return createdProject;
      } catch (error) {
        throw toAppTrpcError(error);
      }
    }),
  updateName: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1, 'Name is required').max(80),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.project.findUnique({
        where: { id: input.id, userId: ctx.auth.userId },
      });
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        });
      }
      try {
        return await prisma.project.update({
          where: { id: input.id },
          data: { name: input.name.trim() },
        });
      } catch (error) {
        throw toAppTrpcError(error);
      }
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const existing = await prisma.project.findUnique({
        where: { id: input.id, userId: ctx.auth.userId },
      });
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        });
      }
      try {
        await prisma.project.delete({ where: { id: input.id } });
        return { ok: true as const };
      } catch (error) {
        throw toAppTrpcError(error);
      }
    }),
});
