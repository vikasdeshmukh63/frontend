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
  /** When true, use the saved key for the active provider instead of the app env key. */
  useOwnApiKey: boolean;
};

/** Serialized on `code-agent/run` so the worker uses settings from dispatch time. */
export type UserAiSettingsSnapshot = {
  provider: AiProviderId;
  apiModel: string;
  openaiApiKey?: string | null;
  anthropicApiKey?: string | null;
  geminiApiKey?: string | null;
  useOwnApiKey?: boolean;
};

function trimKey(value: string | null | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

function hasNonEmptyKey(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function hasSavedKeyForProvider(
  config: UserAiRuntimeConfig,
  provider: AiProviderId = config.provider
): boolean {
  switch (provider) {
    case 'OPENAI':
      return hasNonEmptyKey(config.openaiApiKey);
    case 'ANTHROPIC':
      return hasNonEmptyKey(config.anthropicApiKey);
    case 'GOOGLE_GEMINI':
      return hasNonEmptyKey(config.geminiApiKey);
  }
}

/** True only when the user opted in and has a key for the active provider. */
export function isUsingOwnProviderApiKey(config: UserAiRuntimeConfig): boolean {
  return config.useOwnApiKey && hasSavedKeyForProvider(config);
}

function defaultRuntimeConfig(): UserAiRuntimeConfig {
  return {
    provider: DEFAULT_AI_PROVIDER,
    apiModel: DEFAULT_MODEL_BY_PROVIDER[DEFAULT_AI_PROVIDER],
    useOwnApiKey: false,
  };
}

function rowToRuntimeConfig(row: {
  provider: unknown;
  model: string;
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
  geminiApiKey: string | null;
  useOwnApiKey: boolean;
}): UserAiRuntimeConfig {
  const provider = parseAiProviderId(row.provider);
  const apiModel = coerceModelForProvider(provider, row.model);

  return {
    provider,
    apiModel,
    openaiApiKey: trimKey(row.openaiApiKey),
    anthropicApiKey: trimKey(row.anthropicApiKey),
    geminiApiKey: trimKey(row.geminiApiKey),
    useOwnApiKey: row.useOwnApiKey,
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
    useOwnApiKey: snapshot.useOwnApiKey === true,
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
    useOwnApiKey: config.useOwnApiKey,
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

/** Respects `useOwnApiKey`: when off, always uses the app env key even if a user key is stored. */
export function resolveActiveProviderApiKey(
  config: UserAiRuntimeConfig
): string | undefined {
  switch (config.provider) {
    case 'OPENAI':
      return resolveProviderApiKey(
        config.openaiApiKey,
        'OPENAI',
        config.useOwnApiKey
      );
    case 'ANTHROPIC':
      return resolveProviderApiKey(
        config.anthropicApiKey,
        'ANTHROPIC',
        config.useOwnApiKey
      );
    case 'GOOGLE_GEMINI':
      return resolveProviderApiKey(
        config.geminiApiKey,
        'GOOGLE_GEMINI',
        config.useOwnApiKey
      );
  }
}

/** Respects `useOwnApiKey`: when off, always uses the app env key even if a user key is stored. */
function resolveProviderApiKey(
  userKey: string | undefined,
  provider: AiProviderId,
  useOwnApiKey: boolean
): string | undefined {
  if (useOwnApiKey) {
    return trimKey(userKey) ?? platformApiKeyForProvider(provider);
  }
  return platformApiKeyForProvider(provider);
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
        apiKey: resolveProviderApiKey(
          config.openaiApiKey,
          'OPENAI',
          config.useOwnApiKey
        ),
        defaultParameters: {
          temperature: 0.15,
          /** Large tool payloads truncate without this → invalid tool JSON / parse errors. */
          max_completion_tokens: 20_000,
        },
      });
    case 'ANTHROPIC':
      return anthropic({
        model: config.apiModel,
        apiKey: resolveProviderApiKey(
          config.anthropicApiKey,
          'ANTHROPIC',
          config.useOwnApiKey
        ),
        defaultParameters: {
          max_tokens: 12_000,
          temperature: 0.15,
        },
      });
    case 'GOOGLE_GEMINI':
      return gemini({
        model: config.apiModel,
        apiKey: resolveProviderApiKey(
          config.geminiApiKey,
          'GOOGLE_GEMINI',
          config.useOwnApiKey
        ),
        defaultParameters: {
          generationConfig: {
            temperature: 0.15,
            maxOutputTokens: 12_000,
          },
        },
      });
  }
}
