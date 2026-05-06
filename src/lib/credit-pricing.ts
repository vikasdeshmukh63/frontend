import type { AiProviderId } from '@/lib/ai-catalog';

const CREDITS_PER_DOLLAR = 5;
const DEFAULT_TARGET_GROSS_MARGIN = 0.65;
const OUTPUT_TOKEN_MULTIPLIER = 1.15;
const MIN_OUTPUT_TOKENS = 700;
const MAX_OUTPUT_TOKENS = 6000;
const MIN_GENERATION_CREDITS = 2;

type ModelPrice = {
  inputPerMillion: number;
  outputPerMillion: number;
};

const MODEL_PRICE_USD_PER_MILLION: Record<AiProviderId, Record<string, ModelPrice>> = {
  OPENAI: {
    'gpt-5': { inputPerMillion: 5, outputPerMillion: 15 },
    'gpt-4.1': { inputPerMillion: 2, outputPerMillion: 8 },
    'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
    'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  },
  ANTHROPIC: {
    'claude-opus-4-20250514': { inputPerMillion: 15, outputPerMillion: 75 },
    'claude-sonnet-4-20250514': { inputPerMillion: 3, outputPerMillion: 15 },
    'claude-3-7-sonnet-latest': { inputPerMillion: 3, outputPerMillion: 15 },
    'claude-3-5-haiku-latest': { inputPerMillion: 0.8, outputPerMillion: 4 },
  },
  GOOGLE_GEMINI: {
    'gemini-2.5-pro': { inputPerMillion: 3.5, outputPerMillion: 10.5 },
    'gemini-2.5-flash': { inputPerMillion: 0.35, outputPerMillion: 1.05 },
    'gemini-2.0-flash': { inputPerMillion: 0.2, outputPerMillion: 0.8 },
  },
};

function getTargetMargin(): number {
  const raw = Number(process.env.CREDIT_TARGET_GROSS_MARGIN ?? DEFAULT_TARGET_GROSS_MARGIN);
  if (!Number.isFinite(raw)) return DEFAULT_TARGET_GROSS_MARGIN;
  return Math.min(0.9, Math.max(0.1, raw));
}

function getModelPrice(provider: AiProviderId, model: string): ModelPrice {
  const forProvider = MODEL_PRICE_USD_PER_MILLION[provider];
  return (
    forProvider[model] ??
    Object.values(forProvider)[0] ?? {
      inputPerMillion: 2,
      outputPerMillion: 8,
    }
  );
}

export function estimateGenerationCredits(params: {
  provider: AiProviderId;
  model: string;
  estimatedInputTokens: number;
}) {
  const { provider, model, estimatedInputTokens } = params;
  const inputTokens = Math.max(1, Math.floor(estimatedInputTokens));
  const outputTokens = Math.min(
    MAX_OUTPUT_TOKENS,
    Math.max(MIN_OUTPUT_TOKENS, Math.floor(inputTokens * OUTPUT_TOKEN_MULTIPLIER))
  );
  const price = getModelPrice(provider, model);

  const inputCostUsd = (inputTokens / 1_000_000) * price.inputPerMillion;
  const outputCostUsd = (outputTokens / 1_000_000) * price.outputPerMillion;
  const totalCostUsd = inputCostUsd + outputCostUsd;

  const margin = getTargetMargin();
  const targetRevenueUsd = totalCostUsd / (1 - margin);
  const usdPerCredit = 1 / CREDITS_PER_DOLLAR;
  const credits = Math.max(MIN_GENERATION_CREDITS, Math.ceil(targetRevenueUsd / usdPerCredit));

  return {
    credits,
    margin,
    estimatedCostUsd: totalCostUsd,
    estimatedRevenueUsd: credits * usdPerCredit,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
  };
}

export const MIN_DYNAMIC_GENERATION_CREDITS = MIN_GENERATION_CREDITS;
