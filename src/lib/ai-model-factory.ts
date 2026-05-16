import 'server-only';

import { anthropic, gemini, openai } from '@inngest/agent-kit';

import {
  coerceModelForProvider,
  DEFAULT_AI_PROVIDER,
  DEFAULT_MODEL_BY_PROVIDER,
  isAiProviderId,
  type AiProviderId,
} from '@/lib/ai-catalog';
import { prisma } from '@/lib/db';

export type UserAiRuntimeConfig = {
  provider: AiProviderId;
  apiModel: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
};

export async function getUserAiRuntimeConfig(
  userId: string | undefined
): Promise<UserAiRuntimeConfig> {
  if (!userId) {
    return {
      provider: DEFAULT_AI_PROVIDER,
      apiModel: DEFAULT_MODEL_BY_PROVIDER[DEFAULT_AI_PROVIDER],
    };
  }

  const row = await prisma.userAiSettings.findUnique({
    where: { userId },
  });

  if (!row) {
    return {
      provider: DEFAULT_AI_PROVIDER,
      apiModel: DEFAULT_MODEL_BY_PROVIDER[DEFAULT_AI_PROVIDER],
    };
  }

  const provider: AiProviderId = isAiProviderId(row.provider)
    ? row.provider
    : DEFAULT_AI_PROVIDER;
  const apiModel = coerceModelForProvider(provider, row.model);

  return {
    provider,
    apiModel,
    openaiApiKey: row.openaiApiKey ?? undefined,
    anthropicApiKey: row.anthropicApiKey ?? undefined,
    geminiApiKey: row.geminiApiKey ?? undefined,
  };
}

/**
 * Model adapter for `@inngest/agent-kit` agents (OpenAI, Anthropic, or Gemini).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAgentKitModel(config: UserAiRuntimeConfig): any {
  const trimmed = (v: string | undefined) => {
    const t = v?.trim();
    return t ? t : undefined;
  };

  switch (config.provider) {
    case 'OPENAI':
      return openai({
        model: config.apiModel,
        apiKey: trimmed(config.openaiApiKey),
        defaultParameters: {
          temperature: 0.1,
          /** Large tool payloads truncate without this → invalid tool JSON / parse errors. */
          max_completion_tokens: 16384,
        },
      });
    case 'ANTHROPIC':
      return anthropic({
        model: config.apiModel,
        apiKey: trimmed(config.anthropicApiKey),
        defaultParameters: {
          max_tokens: 8192,
          temperature: 0.1,
        },
      });
    case 'GOOGLE_GEMINI':
      return gemini({
        model: config.apiModel,
        apiKey: trimmed(config.geminiApiKey),
        defaultParameters: {
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
          },
        },
      });
  }
}
