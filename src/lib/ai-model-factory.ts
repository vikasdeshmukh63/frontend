import 'server-only';

import { anthropic, gemini, openai } from '@inngest/agent-kit';

import {
  coerceModelForProvider,
  DEFAULT_AI_PROVIDER,
  DEFAULT_MODEL_BY_PROVIDER,
  parseAiProviderId,
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

/** Serialized on `code-agent/run` so the worker uses settings from dispatch time. */
export type UserAiSettingsSnapshot = {
  provider: AiProviderId;
  apiModel: string;
  openaiApiKey?: string | null;
  anthropicApiKey?: string | null;
  geminiApiKey?: string | null;
};

function trimKey(value: string | null | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

function hasNonEmptyKey(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function isUsingOwnProviderApiKey(config: UserAiRuntimeConfig): boolean {
  switch (config.provider) {
    case 'OPENAI':
      return hasNonEmptyKey(config.openaiApiKey);
    case 'ANTHROPIC':
      return hasNonEmptyKey(config.anthropicApiKey);
    case 'GOOGLE_GEMINI':
      return hasNonEmptyKey(config.geminiApiKey);
  }
}

function defaultRuntimeConfig(): UserAiRuntimeConfig {
  return {
    provider: DEFAULT_AI_PROVIDER,
    apiModel: DEFAULT_MODEL_BY_PROVIDER[DEFAULT_AI_PROVIDER],
  };
}

function rowToRuntimeConfig(row: {
  provider: unknown;
  model: string;
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
  geminiApiKey: string | null;
}): UserAiRuntimeConfig {
  const provider = parseAiProviderId(row.provider);
  const apiModel = coerceModelForProvider(provider, row.model);

  return {
    provider,
    apiModel,
    openaiApiKey: trimKey(row.openaiApiKey),
    anthropicApiKey: trimKey(row.anthropicApiKey),
    geminiApiKey: trimKey(row.geminiApiKey),
  };
}

export function userAiRuntimeConfigFromSnapshot(
  snapshot: UserAiSettingsSnapshot
): UserAiRuntimeConfig {
  const provider = parseAiProviderId(snapshot.provider);
  return {
    provider,
    apiModel: coerceModelForProvider(provider, snapshot.apiModel),
    openaiApiKey: trimKey(snapshot.openaiApiKey),
    anthropicApiKey: trimKey(snapshot.anthropicApiKey),
    geminiApiKey: trimKey(snapshot.geminiApiKey),
  };
}

export function isUserAiSettingsSnapshot(
  value: unknown
): value is UserAiSettingsSnapshot {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return typeof o.provider === 'string' && typeof o.apiModel === 'string';
}

/** Load saved settings for attaching to Inngest events at dispatch time. */
export async function snapshotUserAiSettings(
  userId: string
): Promise<UserAiSettingsSnapshot> {
  const config = await getUserAiRuntimeConfig(userId);
  return {
    provider: config.provider,
    apiModel: config.apiModel,
    openaiApiKey: config.openaiApiKey ?? null,
    anthropicApiKey: config.anthropicApiKey ?? null,
    geminiApiKey: config.geminiApiKey ?? null,
  };
}

export async function getUserAiRuntimeConfig(
  userId: string | undefined
): Promise<UserAiRuntimeConfig> {
  if (!userId) {
    return defaultRuntimeConfig();
  }

  const row = await prisma.userAiSettings.findUnique({
    where: { userId },
  });

  if (!row) {
    return defaultRuntimeConfig();
  }

  return rowToRuntimeConfig(row);
}

/**
 * Prefer event snapshot (captured when the run was queued), then DB by userId,
 * then project owner as a last resort.
 */
export async function resolveUserAiRuntimeConfig(params: {
  userId?: string;
  projectId?: string;
  snapshot?: unknown;
}): Promise<UserAiRuntimeConfig> {
  if (isUserAiSettingsSnapshot(params.snapshot)) {
    return userAiRuntimeConfigFromSnapshot(params.snapshot);
  }

  let userId = params.userId?.trim();
  if (!userId && params.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: params.projectId },
      select: { userId: true },
    });
    userId = project?.userId;
  }

  return getUserAiRuntimeConfig(userId);
}

function platformApiKeyForProvider(provider: AiProviderId): string | undefined {
  switch (provider) {
    case 'OPENAI':
      return process.env.OPENAI_API_KEY?.trim() || undefined;
    case 'ANTHROPIC':
      return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
    case 'GOOGLE_GEMINI':
      return process.env.GEMINI_API_KEY?.trim() || undefined;
  }
}

/** User key when set; otherwise this app's env key for the active provider only. */
function resolveProviderApiKey(
  userKey: string | undefined,
  provider: AiProviderId
): string | undefined {
  return trimKey(userKey) ?? platformApiKeyForProvider(provider);
}

/**
 * Model adapter for `@inngest/agent-kit` agents (OpenAI, Anthropic, or Gemini).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAgentKitModel(config: UserAiRuntimeConfig): any {
  switch (config.provider) {
    case 'OPENAI':
      return openai({
        model: config.apiModel,
        apiKey: resolveProviderApiKey(config.openaiApiKey, 'OPENAI'),
        defaultParameters: {
          temperature: 0.1,
          /** Large tool payloads truncate without this → invalid tool JSON / parse errors. */
          max_completion_tokens: 16384,
        },
      });
    case 'ANTHROPIC':
      return anthropic({
        model: config.apiModel,
        apiKey: resolveProviderApiKey(config.anthropicApiKey, 'ANTHROPIC'),
        defaultParameters: {
          max_tokens: 8192,
          temperature: 0.1,
        },
      });
    case 'GOOGLE_GEMINI':
      return gemini({
        model: config.apiModel,
        apiKey: resolveProviderApiKey(config.geminiApiKey, 'GOOGLE_GEMINI'),
        defaultParameters: {
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
          },
        },
      });
  }
}
