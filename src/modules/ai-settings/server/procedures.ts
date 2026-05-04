import { z } from 'zod';
import { TRPCError } from '@trpc/server';

import { prisma } from '@/lib/db';
import {
  AI_MODELS_BY_PROVIDER,
  AI_PROVIDER_LABELS,
  coerceModelForProvider,
  DEFAULT_AI_PROVIDER,
  getModelOption,
  isValidModelForProvider,
  type AiProviderId,
} from '@/lib/ai-catalog';
import { createTRPCRouter, protectedProcedure } from '@/trpc/init';

const providerSchema = z.enum(['OPENAI', 'ANTHROPIC', 'GOOGLE_GEMINI']);

export const aiSettingsRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const row = await prisma.userAiSettings.findUnique({
      where: { userId: ctx.auth.userId },
    });

    const provider = (row?.provider ?? DEFAULT_AI_PROVIDER) as AiProviderId;
    const model = coerceModelForProvider(provider, row?.model ?? '');

    const opt = getModelOption(provider, model);

    return {
      provider,
      model,
      modelLabel: opt?.label ?? model,
      providerLabel: AI_PROVIDER_LABELS[provider].short,
      hasOpenaiKey: !!row?.openaiApiKey?.trim(),
      hasAnthropicKey: !!row?.anthropicApiKey?.trim(),
      hasGeminiKey: !!row?.geminiApiKey?.trim(),
      models: AI_MODELS_BY_PROVIDER[provider],
    };
  }),

  update: protectedProcedure
    .input(
      z.object({
        provider: providerSchema,
        model: z.string().min(1),
        openaiApiKey: z.string().optional(),
        anthropicApiKey: z.string().optional(),
        geminiApiKey: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const provider = input.provider as AiProviderId;
      if (!isValidModelForProvider(provider, input.model)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'That model is not available for the selected provider.',
        });
      }

      const userId = ctx.auth.userId;

      const trimKey = (v: string | undefined) =>
        v !== undefined ? (v.trim() || null) : undefined;

      const openaiApiKey = trimKey(input.openaiApiKey);
      const anthropicApiKey = trimKey(input.anthropicApiKey);
      const geminiApiKey = trimKey(input.geminiApiKey);

      await prisma.userAiSettings.upsert({
        where: { userId },
        create: {
          userId,
          provider,
          model: input.model,
          openaiApiKey: openaiApiKey ?? null,
          anthropicApiKey: anthropicApiKey ?? null,
          geminiApiKey: geminiApiKey ?? null,
        },
        update: {
          provider,
          model: input.model,
          ...(openaiApiKey !== undefined && { openaiApiKey }),
          ...(anthropicApiKey !== undefined && { anthropicApiKey }),
          ...(geminiApiKey !== undefined && { geminiApiKey }),
        },
      });

      return { ok: true as const };
    }),
});
