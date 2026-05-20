import {
  createAgent,
  createNetwork,
  createState,
  createTool,
  Message,
  type Tool,
} from '@inngest/agent-kit';
import { inngest } from './client';
import { getSandbox, lastAssistantTextMessageContent } from './utils';
import { z } from 'zod';
import { PROMPT } from '@/prompt';
import { prisma } from '@/lib/db';
import {
  createAgentKitModel,
  getUserAiRuntimeConfig,
} from '@/lib/ai-model-factory';
import {
  enforceLocalInputRateLimit,
  estimateInputTokens,
  LocalAiRateLimitError,
} from '@/lib/ai-rate-limit';
import {
  AI_RATE_LIMIT_USER_MESSAGE,
  isProviderRateLimitError,
} from '@/inngest/ai-error-utils';
import {
  ensureAppPageForPreview,
  hasCustomSourceFiles,
} from '@/inngest/auto-wire-page';
import { agentStateHasBuiltAppPage } from '@/inngest/generation-guard';
import {
  loadInitialAgentFilesFromLatestFragment,
  normalizeSandboxRelativePath,
  refreshSandboxDevServer,
  waitForSandboxPreviewReady,
  resolveOrCreateSandboxId,
  syncGraphifyArtifactsToSandbox,
  syncSandboxFilesFromMap,
  snapshotSandboxProjectFiles,
  writeSandboxProjectFiles,
} from '@/inngest/project-sandbox';
import { ensureSandboxBootstrapFiles } from '@/inngest/sandbox-bootstrap';
import {
  ensureUseClientDirective,
  validateProjectFileWrite,
} from '@/inngest/project-file-validation';
import { mergeBootstrapIntoFileMap } from '@/inngest/sandbox-bootstrap';
import {
  formatReferenceImagesPromptSection,
  referenceImagePublicUrls,
  resolveReferenceImagesForSandbox,
  type ReferenceImageInput,
} from '@/inngest/reference-images';
import {
  consumeCreditsAmount,
  InsufficientCreditsError,
  refundFailedGenerationCredits,
} from '@/lib/credit-service';
import { estimateGenerationCredits } from '@/lib/credit-pricing';
import {
  deriveFragmentTitle,
  deriveUserResponse,
} from '@/inngest/generation-metadata';
import {
  createGenerationStatusMessage,
  pushGenerationStep,
  completeGenerationSteps,
} from '@/inngest/generation-status';
import { defaultGenerationProgress } from '@/lib/generation-progress';
import { finishGenerationSession } from '@/lib/code-agent-queue';
import {
  endGenerationSessionSafely,
  hasTerminalAssistantAfterLastUser,
} from '@/lib/generation-reconcile';
import { loadAgentConversationMessages } from '@/inngest/agent-conversation';
import {
  pruneAgentResultsForInngest,
  sanitizeAgentResultForInngest,
  sanitizeMessagesForInngest,
} from '@/lib/agent-result-sanitize';
import { blockedTerminalCommandReason } from '@/inngest/terminal-guard';
import {
  AgentRunTimeoutError,
  codeAgentRunTimeoutMs,
  codeAgentSoftStopBeforeTimeoutMs,
  isSandboxCommandExitError,
  runSandboxCommand,
  SandboxCommandTimeoutError,
  withTimeout,
} from '@/inngest/timeouts';

interface AgentState {
  summary: string;
  files: { [path: string]: string };
  /** Permanent public HTTPS URLs for sandbox img src */
  referenceImagePublicUrls: string[];
}

function truncateForAgentContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated]`;
}

/** AgentKit persists tool results in Inngest steps — keep returns small. */
function truncateToolResult(text: string, maxChars = 2_000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated tool output for Inngest step limit]`;
}

function isInngestStepPayloadTooLargeError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('step input size is greater than the limit') ||
    msg.includes('validating generator opcode')
  );
}

type UnknownRecord = Record<string, unknown>;

function readOptionalString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const v = (obj as UnknownRecord)[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Reads `projectId` / `userId` from an `inngest/function.failed` envelope.
 * The nested trigger event is usually `event.data.event`, but we tolerate small shape differences.
 */
function extractCodeAgentFailureTrigger(event: unknown): {
  projectId?: string;
  userId?: string;
  triggerEventId?: string;
  runId?: string;
} {
  const envelope = event as UnknownRecord;
  const data = envelope['data'] as UnknownRecord | undefined;
  const runId = readOptionalString(data, 'run_id');

  const inner = data?.['event'];
  const trigger =
    inner && typeof inner === 'object' ? (inner as UnknownRecord) : undefined;
  const triggerData =
    trigger?.['data'] && typeof trigger['data'] === 'object'
      ? (trigger['data'] as UnknownRecord)
      : undefined;

  const projectId =
    readOptionalString(triggerData, 'projectId') ??
    readOptionalString(data, 'projectId');
  const userId =
    readOptionalString(triggerData, 'userId') ??
    readOptionalString(data, 'userId');
  const triggerEventId = readOptionalString(trigger, 'id');

  return { projectId, userId, triggerEventId, runId };
}

const STEP_PAYLOAD_TOO_LARGE_USER_MESSAGE =
  'This run sent too much data between agent steps (often from embedding an image in code). Use the full HTTPS URLs from <reference_images> in <img src="..."> only. Your credits have been returned. Try again with a shorter prompt or fewer files.';

const LOCAL_AI_RATE_LIMIT_USER_MESSAGE =
  'Too many AI requests hit the local safety limit for this minute. Wait a minute and try again, send a shorter prompt, pick a lighter model in settings, or raise LOCAL_AI_INPUT_TPM / set DISABLE_LOCAL_AI_RATE_LIMIT=1 in .env for development.';

function codeAgentMaxIterations(): number {
  const raw = process.env.CODE_AGENT_MAX_ITER;
  const n = raw !== undefined && raw !== '' ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n)) {
    return Math.min(8, Math.max(3, n));
  }
  /** Default 4 keeps runs fast; override with CODE_AGENT_MAX_ITER (3–8). */
  return 4;
}

const AI_INVALID_REQUEST_USER_MESSAGE =
  'The AI request payload was empty or invalid for the selected model. Please try again, or send a slightly more specific prompt.';

const AGENT_TIMEOUT_USER_MESSAGE =
  'This generation could not finish in time and no app files were saved. Your credits have been returned. Try a smaller, more specific request.';

const SANDBOX_COMMAND_FAILED_USER_MESSAGE =
  'The preview sandbox reported a shell error while starting or refreshing the dev server (this is often transient). Your credits have been returned. Use Regenerate response or send the request again; if it keeps failing, start a new chat or project.';

const AGENT_TIMEOUT_RECOVERED_NOTE =
  ' The assistant hit the time limit before every optional step finished; your preview was still saved and you can ask for follow-up tweaks.';

function normalizePromptInput(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > 0) return text;
  return 'Build or update the project based on the latest requested change.';
}

function isAgentKitToolArgumentsParseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const m = error.message.toLowerCase();
  return (
    m.includes('failed to parse json with backticks') ||
    (m.includes('failed to parse json') && m.includes('tool')) ||
    m.includes('unable to parse tool') ||
    m.includes('invalid tool arguments') ||
    (m.includes('tool argument') && m.includes('parse')) ||
    /** Truncated or malformed tool JSON from the model (often after output length limits). */
    m.includes('unexpected end of json input') ||
    m.includes('unterminated string') ||
    (m.includes('unexpected token') && m.includes('json'))
  );
}

/** Tiny marker in agent state — full sources live on the sandbox only. */
function agentStateFileMarker(_path: string, _content: string): string {
  return '1';
}

const MAX_AGENT_STATE_FILE_PATHS = 48;

/** Shared by writeProjectFile / createOrUpdateFiles — single code path for sandbox + agent state. */
async function writePathsToSandbox(
  sandboxId: string,
  files: { path: string; content: string }[],
  baseState: Record<string, string>,
  onFileWritten?: (relativePath: string) => void | Promise<void>
): Promise<Record<string, string> | string> {
  try {
    const updatedFiles = { ...baseState };
    const normalized = files.map((file) => {
      const path = normalizeSandboxRelativePath(file.path);
      return {
        path,
        content: ensureUseClientDirective(path, file.content),
      };
    });

    for (const file of normalized) {
      const check = validateProjectFileWrite(file.path, file.content);
      if (!check.ok) return check.error;
    }

    await writeSandboxProjectFiles(sandboxId, normalized);
    for (const file of normalized) {
      updatedFiles[file.path] = agentStateFileMarker(file.path, file.content);
      await onFileWritten?.(file.path);
    }
    const paths = Object.keys(updatedFiles);
    if (paths.length > MAX_AGENT_STATE_FILE_PATHS) {
      const drop = paths.length - MAX_AGENT_STATE_FILE_PATHS;
      for (const p of paths.slice(0, drop)) {
        if (!p.endsWith('page.tsx')) delete updatedFiles[p];
      }
    }
    return updatedFiles;
  } catch (e) {
    return `Error: ${e}`;
  }
}

function isProviderInvalidMessageError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const asObj = error as Record<string, unknown>;
  const directMessage =
    typeof asObj.message === 'string' ? asObj.message.toLowerCase() : '';
  const nested = asObj.error as Record<string, unknown> | undefined;
  const nestedMessage =
    typeof nested?.message === 'string' ? nested.message.toLowerCase() : '';
  const t =
    typeof asObj.type === 'string' ? asObj.type.toLowerCase() : '';
  const nestedType =
    typeof nested?.type === 'string' ? nested.type.toLowerCase() : '';
  const blob = `${directMessage} ${nestedMessage} ${t} ${nestedType}`.trim();
  return (
    blob.includes('invalid_request_error') &&
    blob.includes('at least one message is required')
  );
}

const MAX_FUNCTION_RETRIES = 3 as const;

export const codeAgentFunction = inngest.createFunction(
  {
    id: 'code-agent-v3',
    triggers: [{ event: 'code-agent/run' }],
    /** Stop after this many retries (Inngest default is 3; set explicitly so runs do not loop indefinitely). */
    retries: MAX_FUNCTION_RETRIES,
    onFailure: async ({ error, event }) => {
      const { projectId, userId, triggerEventId, runId } =
        extractCodeAgentFailureTrigger(event);

      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(
        `[code-agent] Job exhausted retries (run ${runId ?? '?'}):`,
        errMsg
      );

      if (!projectId) {
        console.error(
          '[code-agent] onFailure: could not resolve projectId from failure event; UI may stay on loading until stale lock cleanup',
          {
            runId,
            envelopeKeys:
              event && typeof event === 'object'
                ? Object.keys(event as object)
                : [],
          }
        );
        return;
      }

      if (userId) {
        try {
          await refundFailedGenerationCredits({
            userId,
            chargeCorrelationId: triggerEventId
              ? `inngest_gen_charge:${triggerEventId}`
              : `inngest_gen_charge_fallback:${runId ?? 'unknown'}`,
            correlationId: `inngest_gen_fail:${runId ?? 'unknown'}`,
            metadata: { inngestRunId: runId, projectId },
          });
        } catch (e) {
          console.error('[code-agent] Credit refund failed:', e);
        }
      }

      try {
        const hadTerminal = await hasTerminalAssistantAfterLastUser(projectId);
        if (!hadTerminal) {
          await prisma.message.create({
            data: {
              projectId,
              content:
                'This generation stopped after several failed attempts. The credits for this message have been returned to your balance. You can try again in a moment.',
              role: 'ASSISTANT',
              type: 'ERROR',
            },
          });
        }
        await finishGenerationSession(projectId);
      } catch (e) {
        console.error('[code-agent] onFailure: ERROR row or session cleanup failed:', e);
      }
    },
  },
  async ({ event, step, runId }) => {
    const projectId = event.data.projectId;
    const normalizedPrompt = normalizePromptInput(event.data.value);
    const referenceImages: ReferenceImageInput[] = Array.isArray(
      event.data.referenceImages
    )
      ? event.data.referenceImages
          .filter(
            (img): img is ReferenceImageInput =>
              !!img &&
              typeof img === 'object' &&
              typeof (img as ReferenceImageInput).fileName === 'string' &&
              typeof (img as ReferenceImageInput).storageKey === 'string'
          )
          .slice(0, 4)
      : [];
    const userId =
      typeof event.data.userId === 'string' ? event.data.userId : undefined;
    const forceNewSession = event.data.newSession === true;
    const chargeCorrelationId =
      typeof event.id === 'string'
        ? `inngest_gen_charge:${event.id}`
        : `inngest_gen_charge_fallback:${event.data.projectId}:${Date.now()}`;

    const aiConfig = await step.run('load-ai-settings', async () => {
      return getUserAiRuntimeConfig(userId);
    });

    const primaryModel = createAgentKitModel(aiConfig);

    const preCreatedStatusId =
      typeof event.data.generationStatusMessageId === 'string'
        ? event.data.generationStatusMessageId
        : undefined;

    let generationStatusMessageId: string | undefined = preCreatedStatusId;
    const generationProgressRef: { messageId?: string } = {
      messageId: preCreatedStatusId,
    };

    let sessionEnded = false;
    const endSessionOnce = async () => {
      if (sessionEnded) return;
      sessionEnded = true;
      try {
        await endGenerationSessionSafely({
          projectId,
          statusMessageId: generationStatusMessageId,
        });
      } catch (e) {
        console.error('[code-agent] endGenerationSessionSafely failed:', e);
      }
    };

    let sandboxId: string;
    let graphContext: string;
    let referenceImagePrompt: string;
    let resolvedPublicUrls: string[];

    try {
    try {
      ({
        sandboxId,
        graphContext,
        referenceImagePrompt,
        referenceImagePublicUrls: resolvedPublicUrls,
      } = await step.run(
      'prepare-agent-session',
      async () => {
        const projectId = event.data.projectId;

        if (generationStatusMessageId) {
          await pushGenerationStep(
            generationStatusMessageId,
            'Connecting to your dev sandbox',
            { headline: 'Preparing environment…', markPreviousDone: false }
          );
        }

        const initialFiles =
          await loadInitialAgentFilesFromLatestFragment(projectId);

        const sandboxId = await withTimeout(
          resolveOrCreateSandboxId(projectId, forceNewSession),
          3 * 60 * 1000,
          'sandbox setup'
        );

        await prisma.project.update({
          where: { id: projectId },
          data: { e2bSandboxId: sandboxId },
        });

        await syncSandboxFilesFromMap(sandboxId, initialFiles);
        const { context: graphContext } = await syncGraphifyArtifactsToSandbox(
          sandboxId,
          initialFiles,
          normalizedPrompt
        );

        const { resolved: resolvedRefs, failed: failedRefNames } =
          resolveReferenceImagesForSandbox(referenceImages);
        const referenceImagePublicUrlsList =
          referenceImagePublicUrls(resolvedRefs);
        const referenceImagePrompt = formatReferenceImagesPromptSection(
          resolvedRefs,
          failedRefNames
        );

        if (generationStatusMessageId) {
          await pushGenerationStep(
            generationStatusMessageId,
            'Project context ready',
            { headline: 'Preparing environment…' }
          );
        }

        return {
          sandboxId,
          graphContext: truncateForAgentContext(graphContext, 3_000),
          referenceImagePrompt: truncateForAgentContext(
            referenceImagePrompt,
            2_000
          ),
          referenceImagePublicUrls: referenceImagePublicUrlsList,
        };
      }
    ));
    } catch (prepareErr) {
      if (
        prepareErr instanceof AgentRunTimeoutError ||
        prepareErr instanceof SandboxCommandTimeoutError
      ) {
        await step.run('save-sandbox-setup-timeout', async () => {
          await finishGenerationSession(
            event.data.projectId,
            generationStatusMessageId
          );
          return prisma.message.create({
            data: {
              projectId: event.data.projectId,
              content:
                'Could not start the dev sandbox in time (E2B may be slow or unavailable). Please try again in a minute.',
              role: 'ASSISTANT',
              type: 'ERROR',
            },
          });
        });
        return {
          url: '',
          title: '',
          files: {},
          summary: '',
          sandboxSetupTimeout: true as const,
        };
      }
      throw prepareErr;
    }

    const boundedMessages = await loadAgentConversationMessages({
      projectId: event.data.projectId,
      referenceImages,
      referenceImagePublicUrlsList: resolvedPublicUrls ?? [],
    });
    /** File contents stay on the sandbox — never pass source bodies through Inngest steps. */
    const boundedFiles: Record<string, string> = {};

    const state = createState<AgentState>(
      {
        summary: '',
        files: boundedFiles,
        referenceImagePublicUrls: resolvedPublicUrls ?? [],
      },
      {
        messages: boundedMessages,
      }
    );

    const codeAgent = createAgent<AgentState>({
      name: 'code-agent',
      description: 'An expert coding agent',
      system: PROMPT,
      model: primaryModel,
      tools: [
        //terminal tool
        createTool({
          name: 'terminal',
          description: 'Use this tool to run terminal commands',
          parameters: z.object({
            command: z.string(),
          }),
          // No `step.run` here: random or changing step IDs break Inngest replay/finalization
          // (hash mismatch). Top-level function steps stay durable.
          handler: async ({ command }) => {
            const blocked = blockedTerminalCommandReason(command);
            if (blocked) return blocked;

            const buffers = { stdout: '', stderr: '' };

            try {
              const sandbox = await getSandbox(sandboxId);
              const result = await runSandboxCommand(sandbox, command, {
                onStdout: (data: string) => {
                  buffers.stdout += data;
                },
                onStderr: (data: string) => {
                  buffers.stderr += data;
                },
              });
              return truncateToolResult(result.stdout);
            } catch (e) {
              console.error(
                `Command failed: ${e} \nstdout: ${buffers.stdout} \nstderror: ${buffers.stderr}`
              );
              return truncateToolResult(
                `Command failed: ${e} \nstdout: ${buffers.stdout} \nstderror: ${buffers.stderr}`
              );
            }
          },
        }),
        createTool({
          name: 'writeProjectFile',
          description:
            'Write or overwrite one project file (preferred). Use one call per file — smaller payloads parse reliably.',
          parameters: z.object({
            path: z
              .string()
              .describe('Relative path only, e.g. app/page.tsx'),
            content: z
              .string()
              .describe(
                'TypeScript/TSX/CSS source only (max ~48KB). Never base64 or binary image data — use /mock/... paths in code instead. Valid JSON string; escape quotes and newlines.'
              ),
          }),
          handler: async (
            { path, content },
            { network }: Tool.Options<AgentState>
          ) => {
            const newFiles = await writePathsToSandbox(
              sandboxId,
              [{ path, content }],
              network.state.data.files || {},
              async (rel) => {
                if (!generationProgressRef.messageId) return;
                await pushGenerationStep(
                  generationProgressRef.messageId,
                  `Edited ${rel}`,
                  { headline: 'Building…' }
                );
              }
            );
            if (typeof newFiles === 'string') return newFiles;
            network.state.data.files = newFiles;
            return `Wrote ${normalizeSandboxRelativePath(path)}`;
          },
        }),
        //createOrUpdateFiles tool
        createTool({
          name: 'createOrUpdateFiles',
          description:
            'Batch create or update at most 2 small files only. Prefer writeProjectFile for anything larger than a few KB or more than two paths — large batch JSON often fails to parse.',
          parameters: z.object({
            files: z
              .array(
                z.object({
                  path: z
                    .string()
                    .describe('Relative path only, e.g. app/page.tsx'),
                  content: z
                    .string()
                    .describe(
                      'TypeScript/TSX source only (max ~48KB each). No base64/images. JSON-escape quotes and newlines; no markdown fences.'
                    ),
                })
              )
              .min(1)
              .max(2),
          }),
          handler: async (
            { files },
            { network }: Tool.Options<AgentState>
          ) => {
            const newFiles = await writePathsToSandbox(
              sandboxId,
              files,
              network.state.data.files || {},
              async (rel) => {
                if (!generationProgressRef.messageId) return;
                await pushGenerationStep(
                  generationProgressRef.messageId,
                  `Edited ${rel}`,
                  { headline: 'Building…' }
                );
              }
            );
            if (typeof newFiles === 'string') return newFiles;
            network.state.data.files = newFiles;
            return `Wrote ${files.map((f) => normalizeSandboxRelativePath(f.path)).join(', ')}`;
          },
        }),
        createTool({
          name: 'listFiles',
          description:
            'list files in the sandbox to inspect code structure before reading',
          parameters: z.object({
            path: z.string().min(1),
          }),
          handler: async ({ path }) => {
            try {
              const sandbox = await getSandbox(sandboxId);
              const targetPath = path.trim() || '.';
              const result = await runSandboxCommand(
                sandbox,
                `find ${JSON.stringify(targetPath)} -type f | sort`
              );
              return truncateToolResult(result.stdout, 1_500);
            } catch (e) {
              return 'Error: ' + e;
            }
          },
        }),
        createTool({
          name: 'listReferenceImages',
          description:
            'List public HTTPS URLs for user-uploaded images (use exact URL in img src for sandbox preview)',
          parameters: z.object({}),
          handler: async (
            _args,
            { network }: Tool.Options<AgentState>
          ) => {
            const urls = network?.state.data.referenceImagePublicUrls ?? [];
            if (urls.length === 0) {
              return 'No reference images for this run.';
            }
            return JSON.stringify(
              urls.map((publicUrl) => ({
                publicUrl,
                example: `<img src="${publicUrl}" alt="Reference" className="w-full h-auto rounded-lg" />`,
              }))
            );
          },
        }),
        createTool({
          name: 'readFiles',
          description: 'read files from the sandbox',
          parameters: z.object({
            files: z.array(z.string()),
          }),
          handler: async ({ files }) => {
            try {
              const sandbox = await getSandbox(sandboxId);
              const contents: { path: string; content: string }[] = [];
              let totalChars = 0;
              const maxChars = 4_000;
              for (const file of files.slice(0, 8)) {
                const content = await sandbox.files.read(file);
                const slice =
                  totalChars + content.length > maxChars
                    ? content.slice(0, Math.max(0, maxChars - totalChars))
                    : content;
                totalChars += slice.length;
                contents.push({ path: file, content: slice });
                if (totalChars >= maxChars) break;
              }
              return truncateToolResult(JSON.stringify(contents), 3_500);
            } catch (e) {
              return 'Error: ' + e;
            }
          },
        }),
      ],
      lifecycle: {
        onStart: async ({ history, prompt }) => ({
          history: sanitizeMessagesForInngest(history ?? []),
          prompt: prompt ? sanitizeMessagesForInngest(prompt) : [],
          stop: false,
        }),
        onResponse: async ({ result, network }) => {
          const lastAssistantMessageText =
            await lastAssistantTextMessageContent(result);

          if (network) {
            const summary = network.state.data.summary ?? '';
            if (summary.length > 4_000) {
              network.state.data.summary = truncateForAgentContext(summary, 4_000);
            }
            if (lastAssistantMessageText?.includes('<task_summary>')) {
              network.state.data.summary = truncateForAgentContext(
                lastAssistantMessageText,
                4_000
              );
            }
          }
          return result;
        },
        onFinish: async ({ result }) => sanitizeAgentResultForInngest(result),
      },
    });

    const agentNetworkStartedAt = Date.now();
    const agentSoftStopAt =
      agentNetworkStartedAt +
      codeAgentRunTimeoutMs() -
      codeAgentSoftStopBeforeTimeoutMs();

    const network = createNetwork<AgentState>({
      name: 'code-agent-network',
      agents: [codeAgent],
      maxIter: codeAgentMaxIterations(),
      defaultState: state,
      router: async ({ network }) => {
        network.state.setResults(
          pruneAgentResultsForInngest(network.state.results)
        );

        const files = network.state.data.files || {};
        const fileCount = Object.keys(files).length;
        const hasPage = agentStateHasBuiltAppPage(files);
        const hasAppComponents = Object.keys(files).some(
          (p) =>
            (p.startsWith('app/') || p.startsWith('src/app/')) &&
            p.endsWith('.tsx') &&
            !p.endsWith('page.tsx') &&
            !p.includes('layout.tsx')
        );

        const forceStop = Date.now() >= agentSoftStopAt;
        if (forceStop) {
          if (!network.state.data.summary?.trim()) {
            network.state.data.summary = truncateForAgentContext(
              `Built ${fileCount} file(s) for: ${normalizedPrompt.slice(0, 180)}`,
              500
            );
          }
          return;
        }

        if (hasPage) {
          if (!network.state.data.summary?.trim()) {
            network.state.data.summary = truncateForAgentContext(
              `Updated the app (${fileCount} file(s) touched).`,
              500
            );
          }
          return;
        }

        const summary = network.state.data.summary?.trim();
        if (summary && hasAppComponents && !hasPage) {
          return codeAgent;
        }
        if (summary && hasAppComponents && fileCount >= 8) {
          if (!network.state.data.summary?.trim()) {
            network.state.data.summary = truncateForAgentContext(
              'Components are ready; wiring the main page next.',
              500
            );
          }
          return codeAgent;
        }
        if (summary && !hasAppComponents && fileCount === 0) {
          return;
        }
        return codeAgent;
      },
    });

    type AgentRunMeta = {
      summary: string;
      fragmentTitle: string;
      userResponse: string;
      filesWritten: number;
    };

    let agentMeta: AgentRunMeta | undefined;

    try {
      const estimatedInputTokens = estimateInputTokens({
        userPrompt: `${normalizedPrompt}\n\n${graphContext}`,
        systemPrompts: [PROMPT],
        messages: boundedMessages,
        files: boundedFiles,
      });

      await step.run('local-ai-input-rate-limit', async () =>
        enforceLocalInputRateLimit({
          userId,
          projectId: event.data.projectId,
          provider: aiConfig.provider,
          model: aiConfig.apiModel,
          estimatedInputTokens,
        })
      );

      const creditReservation = await step.run(
        'reserve-generation-credits',
        async () => {
          if (!userId) return { ok: true as const, chargedCredits: 0 };

          const pricing = estimateGenerationCredits({
            provider: aiConfig.provider,
            model: aiConfig.apiModel,
            estimatedInputTokens,
          });

          try {
            await consumeCreditsAmount(userId, {
              amount: pricing.credits,
              reason: 'generation_dynamic',
              correlationId: chargeCorrelationId,
              metadata: {
                provider: aiConfig.provider,
                model: aiConfig.apiModel,
                estimatedCostUsd: pricing.estimatedCostUsd,
                estimatedRevenueUsd: pricing.estimatedRevenueUsd,
                targetMargin: pricing.margin,
                estimatedInputTokens: pricing.estimatedInputTokens,
                estimatedOutputTokens: pricing.estimatedOutputTokens,
              },
            });
            return { ok: true as const, chargedCredits: pricing.credits };
          } catch (error) {
            if (error instanceof InsufficientCreditsError) {
              await prisma.message.create({
                data: {
                  projectId: event.data.projectId,
                  content: `Not enough credits for this request. This run needs about ${pricing.credits} credits based on the selected model. Please buy more credits or switch to a lower-cost model.`,
                  role: 'ASSISTANT',
                  type: 'ERROR',
                },
              });
              return {
                ok: false as const,
                chargedCredits: 0,
                requiredCredits: pricing.credits,
              };
            }
            throw error;
          }
        }
      );
      if (!creditReservation.ok) {
        await step.run('release-queue-insufficient-credits', async () => {
          await finishGenerationSession(event.data.projectId);
        });
        return {
          url: '',
          title: '',
          files: {},
          summary: '',
          insufficientCredits: true as const,
          requiredCredits: creditReservation.requiredCredits,
        };
      }

      generationStatusMessageId = await step.run(
        'generation-status-start',
        async () => {
          if (preCreatedStatusId) {
            await pushGenerationStep(
              preCreatedStatusId,
              'Reserving credits',
              { headline: 'Preparing your project…', markPreviousDone: false }
            );
            return preCreatedStatusId;
          }
          const msg = await createGenerationStatusMessage(
            event.data.projectId,
            defaultGenerationProgress('Preparing your project…')
          );
          return msg.id;
        }
      );
      generationProgressRef.messageId = generationStatusMessageId;

      await step.run('generation-status-coding', async () => {
        if (!generationStatusMessageId) return { ok: false as const };
        await pushGenerationStep(
          generationStatusMessageId,
          'Analyzing your request',
          { headline: 'Planning build…', markPreviousDone: false }
        );
        await pushGenerationStep(
          generationStatusMessageId,
          'Writing application code',
          { headline: 'Building…' }
        );
        return { ok: true as const };
      });

      await step.run('generation-status-agent-launch', async () => {
        if (!generationStatusMessageId) return { ok: false as const };
        await pushGenerationStep(
          generationStatusMessageId,
          'Running AI agent (file edits appear below)',
          { headline: 'Building…' }
        );
        return { ok: true as const };
      });

      const runInput = truncateForAgentContext(
        [
          normalizedPrompt,
          referenceImagePrompt,
          `<graph_context>\n${graphContext}\n</graph_context>`,
        ]
          .filter(Boolean)
          .join('\n\n'),
        6_000
      );

      /**
       * AgentKit must call step.run for each LLM/tool round at the function level.
       * Wrapping network.run in an outer step.run breaks nested steps and hangs after
       * generation-status-coding (Inngest shows null, no file output).
       */
      const statusIdForHeartbeat = generationStatusMessageId;
      let heartbeatTick = 0;
      const heartbeat = statusIdForHeartbeat
        ? setInterval(() => {
            heartbeatTick += 1;
            const labels = [
              'AI is planning the layout…',
              'AI is writing components…',
              'AI is still working…',
            ];
            void pushGenerationStep(
              statusIdForHeartbeat,
              labels[heartbeatTick % labels.length]!,
              { headline: 'Building…', markPreviousDone: false }
            ).catch((e) => {
              console.warn('[code-agent] heartbeat update failed:', e);
            });
          }, 22_000)
        : null;

      const hardLimitMs =
        codeAgentRunTimeoutMs() + codeAgentSoftStopBeforeTimeoutMs() / 3;

      let agentResult;
      try {
        agentResult = await withTimeout(
          network.run(runInput, { state }),
          hardLimitMs,
          'code-agent network'
        );
      } finally {
        if (heartbeat) clearInterval(heartbeat);
      }

      const files = agentResult.state.data.files || {};
      const safeSummary =
        (agentResult.state.data.summary || '').trim() ||
        `Task: ${normalizedPrompt}\n\nProvide a concise summary of what was built.`;

      agentMeta = {
        summary: truncateForAgentContext(safeSummary, 2_000),
        fragmentTitle: truncateForAgentContext(
          deriveFragmentTitle(normalizedPrompt, safeSummary),
          120
        ),
        userResponse: truncateForAgentContext(
          deriveUserResponse(normalizedPrompt, safeSummary),
          2_000
        ),
        filesWritten: Object.keys(files).length,
      };
    } catch (err) {
      const isTimeoutError =
        err instanceof AgentRunTimeoutError ||
        err instanceof SandboxCommandTimeoutError;

      if (isTimeoutError) {
        const recovered = await step.run('recover-agent-timeout', async () => {
          const sandboxFiles = await snapshotSandboxProjectFiles(sandboxId);
          if (!hasCustomSourceFiles(sandboxFiles)) return null;
          const partialSummary = truncateForAgentContext(
            `Built from your request: ${normalizedPrompt.slice(0, 240)}`,
            500
          );
          return {
            summary: partialSummary,
            fragmentTitle: truncateForAgentContext(
              deriveFragmentTitle(normalizedPrompt, partialSummary),
              120
            ),
            userResponse: truncateForAgentContext(
              `${deriveUserResponse(normalizedPrompt, partialSummary)}${AGENT_TIMEOUT_RECOVERED_NOTE}`,
              2_000
            ),
            filesWritten: Object.keys(sandboxFiles).length,
          };
        });
        if (recovered) {
          agentMeta = recovered;
        }
      }

      if (!agentMeta) {
      await step.run('clear-generation-status-on-error', async () => {
        await finishGenerationSession(
          event.data.projectId,
          generationStatusMessageId
        );
      });

      if (isInngestStepPayloadTooLargeError(err)) {
        await step.run('save-step-payload-error', async () => {
          if (userId) {
            try {
              await refundFailedGenerationCredits({
                userId,
                chargeCorrelationId,
                correlationId: `inngest_gen_payload_refund:${runId}`,
                metadata: {
                  inngestRunId: runId,
                  projectId: event.data.projectId,
                },
              });
            } catch (e) {
              console.error('[code-agent] Credit refund failed:', e);
            }
          }
          return prisma.message.create({
            data: {
              projectId: event.data.projectId,
              content: STEP_PAYLOAD_TOO_LARGE_USER_MESSAGE,
              role: 'ASSISTANT',
              type: 'ERROR',
            },
          });
        });
        return {
          url: '',
          title: '',
          files: {},
          summary: '',
          stepPayloadTooLarge: true as const,
        };
      }
      if (isSandboxCommandExitError(err)) {
        await step.run('save-sandbox-command-error', async () => {
          if (userId) {
            try {
              await refundFailedGenerationCredits({
                userId,
                chargeCorrelationId,
                correlationId: `inngest_gen_sandbox_mid_refund:${runId}`,
                metadata: {
                  inngestRunId: runId,
                  projectId: event.data.projectId,
                },
              });
            } catch (e) {
              console.error('[code-agent] Credit refund failed:', e);
            }
          }
          return prisma.message.create({
            data: {
              projectId: event.data.projectId,
              content: SANDBOX_COMMAND_FAILED_USER_MESSAGE,
              role: 'ASSISTANT',
              type: 'ERROR',
            },
          });
        });
        return {
          url: '',
          title: '',
          files: {},
          summary: '',
          sandboxCommandFailed: true as const,
        };
      }
      if (err instanceof LocalAiRateLimitError) {
        await step.run('save-local-ai-rate-limit', async () =>
          prisma.message.create({
            data: {
              projectId: event.data.projectId,
              content: LOCAL_AI_RATE_LIMIT_USER_MESSAGE,
              role: 'ASSISTANT',
              type: 'ERROR',
            },
          })
        );
        return {
          url: '',
          title: '',
          files: {},
          summary: '',
          localAiRateLimited: true as const,
        };
      }
      if (isProviderRateLimitError(err)) {
        await step.run('save-provider-rate-limit', async () =>
          prisma.message.create({
            data: {
              projectId: event.data.projectId,
              content: AI_RATE_LIMIT_USER_MESSAGE,
              role: 'ASSISTANT',
              type: 'ERROR',
            },
          })
        );
        return {
          url: '',
          title: '',
          files: {},
          summary: '',
          rateLimited: true as const,
        };
      }
      if (isProviderInvalidMessageError(err)) {
        await step.run('save-invalid-ai-request', async () =>
          prisma.message.create({
            data: {
              projectId: event.data.projectId,
              content: AI_INVALID_REQUEST_USER_MESSAGE,
              role: 'ASSISTANT',
              type: 'ERROR',
            },
          })
        );
        return {
          url: '',
          title: '',
          files: {},
          summary: '',
          invalidRequest: true as const,
        };
      }
      if (isTimeoutError) {
        await step.run('save-agent-timeout', async () => {
          if (userId) {
            try {
              await refundFailedGenerationCredits({
                userId,
                chargeCorrelationId,
                correlationId: `inngest_gen_timeout_refund:${runId}`,
                metadata: {
                  inngestRunId: runId,
                  projectId: event.data.projectId,
                },
              });
            } catch (e) {
              console.error('[code-agent] Credit refund failed:', e);
            }
          }
          return prisma.message.create({
            data: {
              projectId: event.data.projectId,
              content: AGENT_TIMEOUT_USER_MESSAGE,
              role: 'ASSISTANT',
              type: 'ERROR',
            },
          });
        });
        return {
          url: '',
          title: '',
          files: {},
          summary: '',
          agentTimeout: true as const,
        };
      }
      if (isAgentKitToolArgumentsParseError(err)) {
        await step.run('save-tool-arguments-parse-error', async () => {
          if (userId) {
            try {
              await refundFailedGenerationCredits({
                userId,
                chargeCorrelationId,
                correlationId: `inngest_gen_tooljson_refund:${runId}`,
                metadata: {
                  inngestRunId: runId,
                  projectId: event.data.projectId,
                },
              });
            } catch (e) {
              console.error('[code-agent] Credit refund failed:', e);
            }
          }
          return prisma.message.create({
            data: {
              projectId: event.data.projectId,
              content:
                'The assistant returned invalid data while updating files (often a file that was too large, or image/base64 data embedded in code). Your credits have been returned. Please try again with a smaller scope, or ask for fewer components at once — images should use /mock/ paths, not base64 in source files.',
              role: 'ASSISTANT',
              type: 'ERROR',
            },
          });
        });
        return {
          url: '',
          title: '',
          files: {},
          summary: '',
          toolArgumentsParseError: true as const,
        };
      }
      throw err;
      }
    }

    try {
      return await (async () => {
        const { summary, fragmentTitle, userResponse } = agentMeta;

        const statusIdForPostAgent = generationStatusMessageId;
        const postAgentHeartbeat = statusIdForPostAgent
          ? setInterval(() => {
              void pushGenerationStep(
                statusIdForPostAgent,
                'Finishing preview…',
                { headline: 'Finishing up…', markPreviousDone: false }
              ).catch((e) => {
                console.warn('[code-agent] post-agent heartbeat failed:', e);
              });
            }, 25_000)
          : null;

        try {
        await step.run('generation-status-preview', async () => {
          if (!generationStatusMessageId) return;
          await pushGenerationStep(
            generationStatusMessageId,
            'Syncing files to preview',
            { headline: 'Building preview…' }
          );
          await completeGenerationSteps(
            generationStatusMessageId,
            'Building preview…'
          );
        });

        const pageEnsure = await step.run('ensure-app-page', async () => {
          const result = await ensureAppPageForPreview({
            sandboxId,
            userPrompt: normalizedPrompt,
          });
          if (
            result.ok &&
            result.source !== 'existing' &&
            generationStatusMessageId
          ) {
            await pushGenerationStep(
              generationStatusMessageId,
              result.source === 'auto-wire'
                ? `Connected ${result.pagePath} to your components`
                : `Created ${result.pagePath} for preview`,
              { headline: 'Finishing preview…' }
            );
          }
          return {
            ok: result.ok,
            pagePath: result.ok ? result.pagePath : '',
            source: result.ok ? result.source : '',
          };
        });

        const { sandboxUrl, previewReady } = await step.run(
          'finalize-sandbox',
          async () => {
            await ensureSandboxBootstrapFiles(sandboxId);

            const pageAfterBootstrap = await ensureAppPageForPreview({
              sandboxId,
              userPrompt: normalizedPrompt,
            });

            await refreshSandboxDevServer(sandboxId);
            const { ready: previewReady, httpCode } =
              await waitForSandboxPreviewReady(sandboxId);

            if (!previewReady) {
              console.warn(
                `[code-agent] Preview not ready (HTTP ${httpCode}) for sandbox ${sandboxId}`
              );
            }

            const sandbox = await getSandbox(sandboxId);
            return {
              sandboxUrl: `https://${sandbox.getHost(3000)}`,
              previewReady,
              pageSource: pageAfterBootstrap.ok ? pageAfterBootstrap.source : '',
            };
          }
        );

        if (!pageEnsure.ok) {
          await step.run('save-empty-generation-error', async () => {
            if (userId) {
              try {
                await refundFailedGenerationCredits({
                  userId,
                  chargeCorrelationId,
                  correlationId: `inngest_gen_no_page_refund:${runId}`,
                  metadata: {
                    inngestRunId: runId,
                    projectId: event.data.projectId,
                  },
                });
              } catch (e) {
                console.error('[code-agent] Credit refund failed:', e);
              }
            }
            return prisma.message.create({
              data: {
                projectId: event.data.projectId,
                content:
                  'The assistant did not write any app code (no components or page). Your credits have been returned. Try again with a specific request, e.g. "Build an admin dashboard in app/page.tsx".',
                role: 'ASSISTANT',
                type: 'ERROR',
              },
            });
          });
          await step.run('finish-empty-generation', async () => {
            await finishGenerationSession(
              event.data.projectId,
              generationStatusMessageId
            );
          });
          return {
            url: '',
            title: '',
            files: {},
            summary: '',
            noPageGenerated: true as const,
          };
        }

        await step.run('save-result', async () => {
          const sandboxFiles = await snapshotSandboxProjectFiles(sandboxId);
          const baselineFiles = await loadInitialAgentFilesFromLatestFragment(
            event.data.projectId
          );
          const mergedFiles = mergeBootstrapIntoFileMap({
            ...baselineFiles,
            ...sandboxFiles,
          });

          await syncSandboxFilesFromMap(sandboxId, mergedFiles);
          await refreshSandboxDevServer(sandboxId);

          const created = await prisma.message.create({
            data: {
              projectId: event.data.projectId,
              content: userResponse,
              role: 'ASSISTANT',
              type: 'RESULT',
              fragment: {
                create: {
                  sandboxUrl,
                  title: fragmentTitle,
                  files: mergedFiles,
                },
              },
            },
          });
          await finishGenerationSession(
            event.data.projectId,
            generationStatusMessageId
          );
          return { messageId: created.id };
        });

        return {
          url: sandboxUrl,
          title: 'Fragment',
          files: {},
          summary,
        };
        } finally {
          if (postAgentHeartbeat) clearInterval(postAgentHeartbeat);
        }
      })();
    } catch (postAgentErr) {
      console.error('[code-agent] post-agent pipeline failed:', postAgentErr);
      await step.run('post-agent-failure-cleanup', async () => {
        await finishGenerationSession(
          event.data.projectId,
          generationStatusMessageId
        );
        const payloadTooLarge =
          isInngestStepPayloadTooLargeError(postAgentErr);
        if (payloadTooLarge) {
          if (userId) {
            try {
              await refundFailedGenerationCredits({
                userId,
                chargeCorrelationId,
                correlationId: `inngest_gen_payload_refund:${runId}`,
                metadata: {
                  inngestRunId: runId,
                  projectId: event.data.projectId,
                },
              });
            } catch (e) {
              console.error('[code-agent] Credit refund failed:', e);
            }
          }
          await prisma.message.create({
            data: {
              projectId: event.data.projectId,
              content: STEP_PAYLOAD_TOO_LARGE_USER_MESSAGE,
              role: 'ASSISTANT',
              type: 'ERROR',
            },
          });
          return { ok: true as const };
        }
        if (isSandboxCommandExitError(postAgentErr)) {
          if (userId) {
            try {
              await refundFailedGenerationCredits({
                userId,
                chargeCorrelationId,
                correlationId: `inngest_gen_sandbox_refund:${runId}`,
                metadata: {
                  inngestRunId: runId,
                  projectId: event.data.projectId,
                },
              });
            } catch (e) {
              console.error('[code-agent] Credit refund failed:', e);
            }
          }
          await prisma.message.create({
            data: {
              projectId: event.data.projectId,
              content: SANDBOX_COMMAND_FAILED_USER_MESSAGE,
              role: 'ASSISTANT',
              type: 'ERROR',
            },
          });
          return { ok: true as const };
        }
        if (userId) {
          try {
            await refundFailedGenerationCredits({
              userId,
              chargeCorrelationId,
              correlationId: `inngest_gen_post_agent_refund:${runId}`,
              metadata: {
                inngestRunId: runId,
                projectId: event.data.projectId,
              },
            });
          } catch (e) {
            console.error('[code-agent] Credit refund failed:', e);
          }
        }
        await prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content:
              'Something went wrong while saving your preview after the assistant finished. Your credits have been returned. Please try again.',
            role: 'ASSISTANT',
            type: 'ERROR',
          },
        });
        return { ok: true as const };
      });
      return {
        url: '',
        title: '',
        files: {},
        summary: '',
        postAgentFailure: true as const,
      };
    }
    } finally {
      await endSessionOnce();
    }
  }
);
