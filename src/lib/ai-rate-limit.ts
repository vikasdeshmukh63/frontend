import 'server-only';

import { RateLimiterPrisma } from 'rate-limiter-flexible';
import { prisma } from '@/lib/db';
import type { AiProviderId } from '@/lib/ai-catalog';
import type { Message } from '@inngest/agent-kit';

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Total input-token budget per minute per user+model (rolling window). */
const INPUT_TOKEN_LIMIT_PER_MINUTE = readIntEnv('LOCAL_AI_INPUT_TPM', 120_000);

/** Never charge more than this many "points" per generation for the limiter (system prompt is huge). */
const MAX_POINTS_PER_REQUEST = readIntEnv('LOCAL_AI_MAX_POINTS_PER_REQUEST', 6_000);

const REQUEST_RESERVE_TOKENS = 2_000;
const CHARS_PER_TOKEN = 4;

export class LocalAiRateLimitError extends Error {
  readonly code = 'LOCAL_AI_RATE_LIMIT';
  constructor(message: string) {
    super(message);
    this.name = 'LocalAiRateLimitError';
  }
}

const inputTokenLimiter = new RateLimiterPrisma({
  storeClient: prisma,
  tableName: 'usage',
  keyPrefix: 'ai-input-tpm',
  points: INPUT_TOKEN_LIMIT_PER_MINUTE,
  duration: 60,
});

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated for rate-limit safety]`;
}

export function boundMessagesForRateLimit(messages: Message[]): Message[] {
  return messages.slice(-3).map((m) => {
    if (!('content' in m)) return m;
    if (typeof m.content !== 'string') return m;
    const role = 'role' in m ? String(m.role) : 'user';
    const maxChars =
      role === 'assistant'
        ? 900
        : m.content.includes('http')
          ? 800
          : 1_400;
    return { ...m, content: truncateText(m.content, maxChars) };
  });
}

/** Keeps agent network state small so Inngest generator steps stay under size limits. */
export function slimFilesForAgentState(
  files: Record<string, string>
): Record<string, string> {
  const maxCharsPerFile = 400;
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (content.length <= maxCharsPerFile) {
      out[path] = content;
      continue;
    }
    out[path] =
      `${content.slice(0, maxCharsPerFile)}\n/* truncated — use readFiles for full source */`;
  }
  return out;
}

export function boundFilesForRateLimit(
  files: Record<string, string>,
  maxTotalTokens = 8_000
): Record<string, string> {
  let used = 0;
  const next: Record<string, string> = {};

  for (const [path, content] of Object.entries(files)) {
    const fileBudget = Math.max(400, maxTotalTokens - used);
    if (fileBudget <= 0) break;

    const maxCharsForFile = Math.min(content.length, fileBudget * CHARS_PER_TOKEN);
    const bounded = truncateText(content, maxCharsForFile);
    const cost = estimateTextTokens(path) + estimateTextTokens(bounded);

    if (used + cost > maxTotalTokens) break;
    next[path] = bounded;
    used += cost;
  }

  return next;
}

export function estimateInputTokens(args: {
  userPrompt: string;
  systemPrompts: string[];
  messages: Message[];
  files: Record<string, string>;
}): number {
  const promptTokens = estimateTextTokens(args.userPrompt);
  const systemTokens = args.systemPrompts.reduce(
    (sum, s) => sum + estimateTextTokens(s),
    0
  );
  const messageTokens = args.messages.reduce((sum, m) => {
    const roleCost = estimateTextTokens('role' in m ? String(m.role) : 'unknown');
    const contentCost =
      'content' in m
        ? typeof m.content === 'string'
          ? estimateTextTokens(m.content)
          : estimateTextTokens(JSON.stringify(m.content))
        : estimateTextTokens(JSON.stringify(m));
    return sum + roleCost + contentCost;
  }, 0);
  const fileTokens = Object.entries(args.files).reduce(
    (sum, [path, content]) => sum + estimateTextTokens(path) + estimateTextTokens(content),
    0
  );

  return promptTokens + systemTokens + messageTokens + fileTokens;
}

export async function enforceLocalInputRateLimit(args: {
  userId?: string;
  projectId: string;
  provider: AiProviderId;
  model: string;
  estimatedInputTokens: number;
}): Promise<void> {
  if (
    process.env.DISABLE_LOCAL_AI_RATE_LIMIT === '1' ||
    process.env.DISABLE_LOCAL_AI_RATE_LIMIT === 'true'
  ) {
    return;
  }

  const scope = args.userId ?? args.projectId;
  const rawPoints = args.estimatedInputTokens + REQUEST_RESERVE_TOKENS;
  /** Cap per request so one huge system prompt does not consume the whole minute bucket. */
  const points = Math.min(
    INPUT_TOKEN_LIMIT_PER_MINUTE,
    Math.min(MAX_POINTS_PER_REQUEST, rawPoints)
  );
  const key = `${scope}:${args.provider}:${args.model}`;

  try {
    await inputTokenLimiter.consume(key, points);
  } catch {
    throw new LocalAiRateLimitError(
      'Local AI safety limit reached for this model. Please retry shortly, send a smaller prompt, or choose a lighter model.'
    );
  }
}
