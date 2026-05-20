/** Prefix for transient assistant rows shown while Inngest runs. */
export const GENERATION_STATUS_PREFIX = '[status] ';

export function formatGenerationStatus(text: string): string {
  return `${GENERATION_STATUS_PREFIX}${text}`;
}

export function parseGenerationStatus(content: string): string {
  return content.startsWith(GENERATION_STATUS_PREFIX)
    ? content.slice(GENERATION_STATUS_PREFIX.length)
    : content;
}

/** Plain headline when status is JSON progress payload. */
export function parseGenerationStatusHeadline(content: string): string {
  const raw = parseGenerationStatus(content);
  try {
    const parsed = JSON.parse(raw) as { headline?: string };
    if (parsed?.headline && typeof parsed.headline === 'string') {
      return parsed.headline;
    }
  } catch {
    /* plain text */
  }
  return raw;
}

export function isGenerationStatusMessage(message: {
  role: string;
  content: string;
  fragment?: unknown;
}): boolean {
  return (
    message.role === 'ASSISTANT' &&
    !message.fragment &&
    message.content.startsWith(GENERATION_STATUS_PREFIX)
  );
}

type MessageForGenerationCheck = {
  role: string;
  type?: string;
  fragment?: unknown;
  content: string;
};

/**
 * True only while a run is actually in progress.
 * Stops when we have a fragment OR an ERROR after the latest user message,
 * even if a stale status row was not deleted.
 */
type StatusMessageWithAge = MessageForGenerationCheck & {
  updatedAt?: Date | string;
};

export function isProjectActivelyGenerating(
  messages: MessageForGenerationCheck[],
  statusMessage?: StatusMessageWithAge,
  options?: { staleStatusMs?: number }
): boolean {
  const visible = messages.filter((m) => !isGenerationStatusMessage(m));
  const lastUserIndex = visible.findLastIndex((m) => m.role === 'USER');
  if (lastUserIndex < 0) return false;

  const afterUser = visible.slice(lastUserIndex + 1);
  const hasTerminalAssistant = afterUser.some(
    (m) =>
      m.role === 'ASSISTANT' &&
      !isGenerationStatusMessage(m) &&
      (m.type === 'ERROR' ||
        !!m.fragment ||
        (m.type === 'RESULT' && m.content.trim().length > 0))
  );

  /** Terminal assistant after the user prompt — run is done (ignore stale status rows). */
  if (hasTerminalAssistant) return false;

  const staleMs = options?.staleStatusMs ?? 4 * 60 * 1000;
  if (statusMessage?.updatedAt) {
    const updated =
      statusMessage.updatedAt instanceof Date
        ? statusMessage.updatedAt.getTime()
        : new Date(statusMessage.updatedAt).getTime();
    if (Number.isFinite(updated) && Date.now() - updated > staleMs) {
      return false;
    }
  }

  if (statusMessage || messages.some((m) => isGenerationStatusMessage(m))) {
    return true;
  }

  /** User prompt sent; assistant has not replied yet (status row may not exist for a moment). */
  return afterUser.length === 0;
}

/** Latest assistant message that carries a preview fragment (ignores transient [status] rows). */
export function findLatestFragmentMessage<
  T extends { role: string; content: string; fragment?: unknown; createdAt?: Date },
>(messages: T[]): (T & { fragment: NonNullable<T['fragment']> }) | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m.role === 'ASSISTANT' &&
      m.fragment &&
      !isGenerationStatusMessage(m)
    ) {
      return m as T & { fragment: NonNullable<T['fragment']> };
    }
  }
  return undefined;
}
