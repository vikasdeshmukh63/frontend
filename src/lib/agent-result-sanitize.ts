import type { AgentResult, Message } from '@inngest/agent-kit';

import { truncateForStepPayload } from '@/lib/inngest-step-payload';

/** Keep tool args in Inngest step inputs tiny; full sources live on the sandbox. */
const MAX_TOOL_ARG_FIELD_CHARS = 240;
const MAX_TEXT_MESSAGE_CHARS = 1_200;
const MAX_TOOL_RESULT_CHARS = 2_000;
const MAX_RESULTS_RETAINED = 2;

const FILE_WRITE_TOOL_NAMES = new Set([
  'writeProjectFile',
  'createOrUpdateFiles',
]);

function truncateField(value: unknown, max: number): unknown {
  if (typeof value === 'string') {
    return truncateForStepPayload(value, max);
  }
  if (Array.isArray(value)) {
    return value.map((item) => truncateField(item, max));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateField(v, max);
    }
    return out;
  }
  return value;
}

function slimToolInput(
  toolName: string,
  input: Record<string, unknown>
): Record<string, unknown> {
  if (!FILE_WRITE_TOOL_NAMES.has(toolName)) {
    return truncateField(input, MAX_TOOL_ARG_FIELD_CHARS) as Record<
      string,
      unknown
    >;
  }

  if (toolName === 'writeProjectFile') {
    const path = typeof input.path === 'string' ? input.path : '';
    const len =
      typeof input.content === 'string' ? input.content.length : 0;
    return {
      path,
      content: `[${len} chars written to sandbox — use readFiles if needed]`,
    };
  }

  if (toolName === 'createOrUpdateFiles' && Array.isArray(input.files)) {
    return {
      files: input.files.map((f) => {
        if (!f || typeof f !== 'object') return f;
        const file = f as { path?: string; content?: string };
        const path = typeof file.path === 'string' ? file.path : '';
        const len =
          typeof file.content === 'string' ? file.content.length : 0;
        return {
          path,
          content: `[${len} chars on sandbox]`,
        };
      }),
    };
  }

  return truncateField(input, MAX_TOOL_ARG_FIELD_CHARS) as Record<
    string,
    unknown
  >;
}

/** Shrinks messages before each `step.ai.infer` (history + prior tool rounds). */
export function sanitizeMessagesForInngest(messages: Message[]): Message[] {
  return messages.map((msg) => {
    if (msg.type === 'text') {
      const content =
        typeof msg.content === 'string'
          ? truncateForStepPayload(msg.content, MAX_TEXT_MESSAGE_CHARS)
          : msg.content;
      return { ...msg, content };
    }

    if (msg.type === 'tool_call' && Array.isArray(msg.tools)) {
      return {
        ...msg,
        tools: msg.tools.map((t) => ({
          ...t,
          input: slimToolInput(t.name, t.input ?? {}),
        })),
      };
    }

    if (msg.type === 'tool_result') {
      const content =
        typeof msg.content === 'string'
          ? truncateForStepPayload(msg.content, MAX_TOOL_RESULT_CHARS)
          : truncateField(msg.content, MAX_TOOL_RESULT_CHARS);
      return { ...msg, content };
    }

    return msg;
  });
}

/** Strip large fields from a finished agent round before it is appended to network state. */
export function sanitizeAgentResultForInngest(result: AgentResult): AgentResult {
  result.output = sanitizeMessagesForInngest(result.output);
  result.toolCalls = result.toolCalls.map((tr) => {
    const slimTool = {
      ...tr.tool,
      input: slimToolInput(tr.tool.name, tr.tool.input ?? {}),
    };
    const content =
      typeof tr.content === 'string'
        ? truncateForStepPayload(tr.content, MAX_TOOL_RESULT_CHARS)
        : truncateField(tr.content, MAX_TOOL_RESULT_CHARS);
    return { ...tr, tool: slimTool, content };
  });
  if (result.history) {
    result.history = sanitizeMessagesForInngest(result.history);
  }
  if (result.prompt) {
    result.prompt = sanitizeMessagesForInngest(result.prompt);
  }
  result.raw = '';
  return result;
}

export function pruneAgentResultsForInngest(
  results: AgentResult[]
): AgentResult[] {
  const tail = results.slice(-MAX_RESULTS_RETAINED);
  return tail.map((r) => sanitizeAgentResultForInngest(r));
}
