import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { prisma } from "@/lib/db";
import {
  enqueueCodeAgentRun,
  isProjectGenerationBusy,
  processNextCodeAgentQueueItem,
  tryDispatchCodeAgentRun,
} from "@/lib/code-agent-queue";
import { releaseStaleGenerationLocks } from "@/lib/generation-lock";
import {
  linkAttachmentsToMessage,
  type AttachmentRecord,
} from "@/lib/message-attachments";
import { buildAttachmentProxyUrl } from "@/lib/attachment-url";
import { buildAttachmentPublicUrl } from "@/lib/object-storage";
import { protectedProcedure, createTRPCRouter } from "@/trpc/init";
import { toAppTrpcError } from "@/lib/prisma-errors";

const attachmentIdsSchema = z
  .array(z.string().uuid())
  .max(4)
  .optional();

export const messagesRouter = createTRPCRouter({
  getMany: protectedProcedure
  .input(
      z.object({
        projectId: z.string().min(1, { message: "Project ID is required" }),
      }),
    )
    .query(async ({ input, ctx }) => {
      await releaseStaleGenerationLocks(input.projectId);
      void processNextCodeAgentQueueItem(input.projectId).catch((e) => {
        console.error('[messages.getMany] queue drain failed:', e);
      });

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
          attachments: {
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      return messages.map((message) => ({
        ...message,
        attachments: message.attachments.map((att) => ({
          ...att,
          publicUrl: buildAttachmentProxyUrl(input.projectId, att.id),
        })),
      }));
    }),
  getQueue: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
      })
    )
    .query(async ({ input, ctx }) => {
      const project = await prisma.project.findUnique({
        where: { id: input.projectId, userId: ctx.auth.userId },
        select: { id: true },
      });
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const items = await prisma.codeAgentQueueItem.findMany({
        where: { projectId: input.projectId, status: "PENDING" },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          createdAt: true,
          payload: true,
        },
      });

      const isRunActive = await isProjectGenerationBusy(input.projectId);

      return {
        isRunActive,
        items: items.map((item, index) => {
          const payload = item.payload as { value?: string };
          const preview = (payload.value ?? "").trim().slice(0, 120);
          return {
            id: item.id,
            kind: item.kind,
            position: index + 1,
            preview: preview || "Queued request",
            createdAt: item.createdAt,
          };
        }),
      };
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

      const dispatch = await tryDispatchCodeAgentRun({
        value: input.value,
        projectId: input.projectId,
        userId: ctx.auth.userId,
        newSession: false,
      });

      let queuePosition: number | undefined;
      if (!dispatch.started) {
        const queued = await enqueueCodeAgentRun({
          projectId: input.projectId,
          userId: ctx.auth.userId,
          kind: "EDIT",
          payload: { value: input.value },
        });
        queuePosition = queued.position;
      }

      return {
        ...edited,
        queued: !dispatch.started,
        queuePosition,
      };
    }),
  regenerateResponse: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          assistantMessageId: z.string().min(1).optional(),
          userMessageId: z.string().min(1).optional(),
        })
        .refine(
          (data) => !!(data.assistantMessageId || data.userMessageId),
          {
            message:
              'Provide assistantMessageId (failed response) or userMessageId',
          }
        )
    )
    .mutation(async ({ input, ctx }) => {
      const project = await prisma.project.findUnique({
        where: {
          id: input.projectId,
          userId: ctx.auth.userId,
        },
      });

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      let userMessage: {
        id: string;
        content: string;
        attachments: { storageKey: string; fileName: string }[];
      } | null = null;

      if (input.userMessageId) {
        const row = await prisma.message.findUnique({
          where: { id: input.userMessageId },
          include: {
            attachments: { orderBy: { createdAt: 'asc' } },
          },
        });

        if (!row || row.projectId !== input.projectId) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Message not found',
          });
        }
        if (row.role !== 'USER') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only user prompts can be regenerated',
          });
        }

        userMessage = row;
      } else if (input.assistantMessageId) {
        const failed = await prisma.message.findUnique({
          where: { id: input.assistantMessageId },
        });

        if (!failed || failed.projectId !== input.projectId) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Message not found',
          });
        }
        if (failed.role !== 'ASSISTANT') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid message',
          });
        }
        if (failed.type !== 'ERROR') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only failed responses can be regenerated',
          });
        }

        const row = await prisma.message.findFirst({
          where: {
            projectId: input.projectId,
            role: 'USER',
            createdAt: { lte: failed.createdAt },
          },
          orderBy: { createdAt: 'desc' },
          include: {
            attachments: { orderBy: { createdAt: 'asc' } },
          },
        });

        if (!row) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'No user message found for this failed response',
          });
        }

        userMessage = row;
      }

      if (!userMessage) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Could not resolve prompt to regenerate',
        });
      }

      try {
        const referenceImages = userMessage.attachments.map((a) => ({
          fileName: a.fileName,
          publicUrl: buildAttachmentPublicUrl(a.storageKey),
          storageKey: a.storageKey,
        }));

        const dispatch = await tryDispatchCodeAgentRun({
          projectId: input.projectId,
          userId: ctx.auth.userId,
          value: userMessage.content,
          newSession: false,
          referenceImages,
        });

        let queuePosition: number | undefined;
        if (!dispatch.started) {
          const queued = await enqueueCodeAgentRun({
            projectId: input.projectId,
            userId: ctx.auth.userId,
            kind: "REGENERATE",
            payload: {
              value: userMessage.content,
              referenceImages,
              userMessageId: userMessage.id,
            },
          });
          queuePosition = queued.position;
        }

        return {
          ok: true as const,
          userMessageId: userMessage.id,
          queued: !dispatch.started,
          queuePosition,
        };
      } catch (error) {
        throw toAppTrpcError(error);
      }
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
        value: z.string().max(10000, { message: "Value is too long" }),
        projectId: z.string().min(1, { message: "Project ID is required" }),
        attachmentIds: attachmentIdsSchema,
        newSession: z.boolean().optional(),
      }).refine(
        (data) => data.value.trim().length > 0 || (data.attachmentIds?.length ?? 0) > 0,
        { message: 'Enter a message or attach at least one image' }
      ),
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
            content: input.value.trim() || 'Build from the attached reference image(s).',
            role: "USER",
            type: "RESULT",
          },
        });

        const linked = await linkAttachmentsToMessage(
          input.attachmentIds ?? [],
          createdMessage.id,
          input.projectId,
          ctx.auth.userId
        );

        const referenceImages = linked.map((a: AttachmentRecord) => ({
          fileName: a.fileName,
          publicUrl: buildAttachmentPublicUrl(a.storageKey),
          storageKey: a.storageKey,
        }));

        let dispatch = await tryDispatchCodeAgentRun({
          value: createdMessage.content,
          projectId: input.projectId,
          userId: ctx.auth.userId,
          newSession: input.newSession === true,
          referenceImages,
        });

        if (!dispatch.started) {
          const { releaseStaleGenerationLocks } = await import(
            '@/lib/generation-lock'
          );
          await releaseStaleGenerationLocks(input.projectId);
          dispatch = await tryDispatchCodeAgentRun({
            value: createdMessage.content,
            projectId: input.projectId,
            userId: ctx.auth.userId,
            newSession: input.newSession === true,
            referenceImages,
          });
        }

        let queuePosition: number | undefined;
        if (!dispatch.started) {
          const queued = await enqueueCodeAgentRun({
            projectId: input.projectId,
            userId: ctx.auth.userId,
            kind: "CHAT",
            payload: {
              value: createdMessage.content,
              newSession: input.newSession === true,
              referenceImages,
            },
          });
          queuePosition = queued.position;
        }

        const created = await prisma.message.findUniqueOrThrow({
          where: { id: createdMessage.id },
          include: {
            fragment: true,
            editedFrom: true,
            attachments: { orderBy: { createdAt: 'asc' } },
          },
        });

        return {
          ...created,
          attachments: created.attachments.map((att) => ({
            ...att,
            publicUrl: buildAttachmentProxyUrl(input.projectId, att.id),
          })),
          queued: !dispatch.started,
          queuePosition,
        };
      } catch (error) {
        throw toAppTrpcError(error);
      }
    }),
});