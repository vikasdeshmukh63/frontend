/**
 * Inngest step outputs are persisted and replayed — keep them small (<< 4MB).
 * Full project sources live on the E2B sandbox; fragments load via snapshot at save time.
 */

export const MAX_INNGEST_STEP_STRING = 4_000;

export function truncateForStepPayload(text: string, max = MAX_INNGEST_STEP_STRING): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated for Inngest step limit]`;
}

/** Strip file bodies from step outputs — paths only. */
export function filePathsOnly(files: Record<string, string>): string[] {
  return Object.keys(files).slice(0, 64);
}
