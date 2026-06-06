export const AI_PROVIDER_IDS = [
  'OPENAI',
  'ANTHROPIC',
  'GOOGLE_GEMINI',
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export function isAiProviderId(v: string): v is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(v);
}

/** Normalize Prisma enum / unknown values to a known provider id. */
export function parseAiProviderId(value: unknown): AiProviderId {
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  return isAiProviderId(raw) ? raw : DEFAULT_AI_PROVIDER;
}

export type AiModelOption = {
  apiModel: string;
  label: string;
  description: string;
};

export const AI_PROVIDER_LABELS: Record<
  AiProviderId,
  { short: string; description: string }
> = {
  OPENAI: {
    short: 'OpenAI',
    description: 'GPT models with strong tool use for coding agents.',
  },
  ANTHROPIC: {
    short: 'Anthropic',
    description: 'Claude models with long context and careful reasoning.',
  },
  GOOGLE_GEMINI: {
    short: 'Google Gemini',
    description: 'Fast and capable Gemini models.',
  },
};

export const AI_MODELS_BY_PROVIDER: Record<AiProviderId, AiModelOption[]> = {
  OPENAI: [
    {
      apiModel: 'gpt-5',
      label: 'GPT-5',
      description: 'Latest flagship model — best overall quality.',
    },
    {
      apiModel: 'gpt-4.1',
      label: 'GPT-4.1',
      description: 'Recommended default — strong coding and polished UI generation.',
    },
    {
      apiModel: 'gpt-4o',
      label: 'GPT-4o',
      description: 'Balanced speed and quality for most builds.',
    },
    {
      apiModel: 'gpt-4o-mini',
      label: 'GPT-4o mini',
      description: 'Faster responses, lower cost.',
    },
  ],
  ANTHROPIC: [
    {
      apiModel: 'claude-opus-4-20250514',
      label: 'Claude Opus 4',
      description: 'Maximum capability for hard problems.',
    },
    {
      apiModel: 'claude-sonnet-4-20250514',
      label: 'Claude Sonnet 4',
      description: 'Recommended default — excellent for full app builds.',
    },
    {
      apiModel: 'claude-3-7-sonnet-latest',
      label: 'Claude 3.7 Sonnet',
      description: 'Stable, proven Sonnet generation.',
    },
    {
      apiModel: 'claude-3-5-haiku-latest',
      label: 'Claude 3.5 Haiku',
      description: 'Very quick for lighter changes.',
    },
  ],
  GOOGLE_GEMINI: [
    {
      apiModel: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      description: 'Recommended default — best Gemini quality for complete UIs.',
    },
    {
      apiModel: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      description: 'Fast with strong results for everyday tasks.',
    },
    {
      apiModel: 'gemini-2.0-flash',
      label: 'Gemini 2.0 Flash',
      description: 'Efficient and responsive.',
    },
  ],
};

export const DEFAULT_AI_PROVIDER: AiProviderId = 'OPENAI';

export const DEFAULT_MODEL_BY_PROVIDER: Record<AiProviderId, string> = {
  OPENAI: 'gpt-4.1',
  ANTHROPIC: 'claude-sonnet-4-20250514',
  GOOGLE_GEMINI: 'gemini-2.5-pro',
};

export function isValidModelForProvider(
  provider: AiProviderId,
  apiModel: string
): boolean {
  return AI_MODELS_BY_PROVIDER[provider].some((m) => m.apiModel === apiModel);
}

export function getModelOption(
  provider: AiProviderId,
  apiModel: string
): AiModelOption | undefined {
  return AI_MODELS_BY_PROVIDER[provider].find((m) => m.apiModel === apiModel);
}

export function coerceModelForProvider(
  provider: AiProviderId,
  apiModel: string
): string {
  if (isValidModelForProvider(provider, apiModel)) return apiModel;
  return DEFAULT_MODEL_BY_PROVIDER[provider];
}
