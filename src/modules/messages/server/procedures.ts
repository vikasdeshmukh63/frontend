import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { prisma } from "@/lib/db";
import { inngest } from "@/inngest/client";
import { protectedProcedure, createTRPCRouter } from "@/trpc/init";
import { toAppTrpcError } from "@/lib/prisma-errors";

export const messagesRouter = createTRPCRouter({
  getMany: protectedProcedure
  .input(
      z.object({
        projectId: z.string().min(1, { message: "Project ID is required" }),
      }),
    )
    .query(async ({ input, ctx }) => {
      const messages = await prisma.message.findMany({
        where: {
          projectId: input.projectId,
          project: {
            userId: ctx.auth.userId,
          },
        },
        include: {
          fragment: true,
          editedFrom: true,
        },
        orderBy: {
          updatedAt: "asc",
        },
      });

      return messages;
    }),
  editUserMessage: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        messageId: z.string().min(1),
        value: z.string().min(1).max(10000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const message = await prisma.message.findUnique({
        where: { id: input.messageId },
        include: { project: true },
      });

      if (!message || message.projectId !== input.projectId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });
      }
      if (message.project.userId !== ctx.auth.userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      }
      if (message.role !== 'USER') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only user messages can be edited',
        });
      }

      const edited = await prisma.message.create({
        data: {
          projectId: input.projectId,
          content: input.value,
          role: 'USER',
          type: 'RESULT',
          editedFromId: message.id,
        },
        include: { fragment: true, editedFrom: true },
      });

      await inngest.send({
        name: 'code-agent/run',
        data: {
          value: input.value,
          projectId: input.projectId,
          userId: ctx.auth.userId,
          newSession: false,
        },
      });

      return edited;
    }),
  revertToFragment: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        fragmentId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const fragment = await prisma.fragment.findUnique({
        where: { id: input.fragmentId },
        include: { message: { include: { project: true } } },
      });

      if (!fragment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fragment not found' });
      }
      if (fragment.message.projectId !== input.projectId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Fragment does not belong to this project',
        });
      }
      if (fragment.message.project.userId !== ctx.auth.userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
      }

      const reverted = await prisma.message.create({
        data: {
          projectId: input.projectId,
          content: `Reverted to: ${fragment.title}`,
          role: 'ASSISTANT',
          type: 'RESULT',
          fragment: {
            create: {
              sandboxUrl: fragment.sandboxUrl,
              title: `Reverted: ${fragment.title}`.slice(0, 120),
              files: fragment.files as object,
            },
          },
        },
        include: { fragment: true },
      });

      return reverted;
    }),
  create: protectedProcedure
    .input(
      z.object({
        value: z.string()
          .min(1, { message: "Value is required" })
          .max(10000, { message: "Value is too long" }),
        projectId: z.string().min(1, { message: "Project ID is required" }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      let existingProject;
      try {
        existingProject = await prisma.project.findUnique({
          where: {
            id: input.projectId,
            userId: ctx.auth.userId,
          },
        });
      } catch (error) {
        throw toAppTrpcError(error);
      }

      if (!existingProject) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      try {
        const createdMessage = await prisma.message.create({
          data: {
            projectId: existingProject.id,
            content: input.value,
            role: "USER",
            type: "RESULT",
          },
        });

        await inngest.send({
          name: "code-agent/run",
          data: {
            value: input.value,
            projectId: input.projectId,
            userId: ctx.auth.userId,
            newSession: false,
          },
        });

        return createdMessage;
      } catch (error) {
        throw toAppTrpcError(error);
      }
    }),
});