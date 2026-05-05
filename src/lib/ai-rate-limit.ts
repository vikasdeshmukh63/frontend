import 'server-only';

import { RateLimiterPrisma } from 'rate-limiter-flexible';
import { prisma } from '@/lib/db';
import type { AiProviderId } from '@/lib/ai-catalog';
import type { Message } from '@inngest/agent-kit';

const INPUT_TOKEN_LIMIT_PER_MINUTE = 24_000;
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
  return messages.slice(-6).map((m) => {
    if (!('content' in m)) return m;
    if (typeof m.content !== 'string') return m;
    return { ...m, content: truncateText(m.content, 2_500) };
  });
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
  const scope = args.userId ?? args.projectId;
  const points = Math.min(
    INPUT_TOKEN_LIMIT_PER_MINUTE,
    args.estimatedInputTokens + REQUEST_RESERVE_TOKENS
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
