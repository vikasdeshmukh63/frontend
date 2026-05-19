/** User-facing copy when upstream LLM rejects the request due to TPM/RPM limits. */
export const AI_RATE_LIMIT_USER_MESSAGE =
  "The AI provider’s rate limit was reached (often tokens or requests per minute). Wait a short time and try again, send a shorter message, or switch to another model or provider in the chat settings—for example a smaller/fast model—to stay under the limit. See your provider’s rate-limit docs for details.";

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 6) return;
  if (value == null) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return;
  }
  if (value instanceof Error) {
    out.push(value.message);
    if (value.cause) collectStrings(value.cause, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.type === "string") out.push(o.type);
    if (typeof o.message === "string") out.push(o.message);
    if (o.error) collectStrings(o.error, out, depth + 1);
    if (o.cause) collectStrings(o.cause, out, depth + 1);
    if (o.data) collectStrings(o.data, out, depth + 1);
    if (o.body) collectStrings(o.body, out, depth + 1);
  }
}

/**
 * Detects Anthropic/OpenAI-style rate limit payloads and common 429 wording.
 */
export function isProviderRateLimitError(error: unknown): boolean {
  const parts: string[] = [];
  collectStrings(error, parts);
  const blob = parts.join(" ").toLowerCase();

  if (blob.includes("rate_limit_error")) return true;
  if (blob.includes("rate limit")) return true;
  if (blob.includes("tokens per minute")) return true;
  if (blob.includes("requests per minute")) return true;
  if (blob.includes("tpm") && blob.includes("limit")) return true;
  if (blob.includes("rpm") && blob.includes("limit")) return true;
  if (blob.includes("too many requests")) return true;
  if (blob.includes("429")) return true;
  if (blob.includes("unsuccessful status code: 429")) return true;

  if (typeof error === "object" && error !== null) {
    const t = (error as { type?: string }).type;
    if (t === "rate_limit_error") return true;
    const code = (error as { code?: string }).code;
    if (code === 'LOCAL_AI_RATE_LIMIT') return true;
    const name = (error as { name?: string }).name;
    if (name === 'LocalAiRateLimitError') return true;
    const err = (error as { error?: { type?: string } }).error;
    if (err?.type === "rate_limit_error") return true;
  }

  return false;
}
