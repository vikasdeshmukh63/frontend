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
import { FRAGMENT_TITLE_PROMPT, PROMPT, RESPONSE_PROMPT } from '@/prompt';
import { prisma } from '@/lib/db';
import {
  createAgentKitModel,
  getUserAiRuntimeConfig,
} from '@/lib/ai-model-factory';
import {
  boundFilesForRateLimit,
  boundMessagesForRateLimit,
  enforceLocalInputRateLimit,
  estimateInputTokens,
} from '@/lib/ai-rate-limit';
import {
  AI_RATE_LIMIT_USER_MESSAGE,
  isProviderRateLimitError,
} from '@/inngest/ai-error-utils';
import {
  loadInitialAgentFilesFromLatestFragment,
  resolveOrCreateSandboxId,
  syncGraphifyArtifactsToSandbox,
  syncSandboxFilesFromMap,
  snapshotSandboxProjectFiles,
} from '@/inngest/project-sandbox';
import {
  consumeCreditsAmount,
  InsufficientCreditsError,
  refundFailedGenerationCredits,
} from '@/lib/credit-service';
import { estimateGenerationCredits } from '@/lib/credit-pricing';

interface AgentState {
  summary: string;
  files: { [path: string]: string };
}

const AI_INVALID_REQUEST_USER_MESSAGE =
  'The AI request payload was empty or invalid for the selected model. Please try again, or send a slightly more specific prompt.';

function normalizePromptInput(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > 0) return text;
  return 'Build or update the project based on the latest requested change.';
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
    onFailure: async ({ error, event, step }) => {
      const original = event.data.event as {
        id?: string;
        data?: {
          projectId?: string;
          userId?: string;
        };
      };
      const triggerEventId =
        typeof original?.id === 'string' ? original.id : undefined;
      const projectId = original?.data?.projectId;
      const userId = original?.data?.userId;
      const runId = event.data.run_id;

      await step.run('generation-failed-finalize', async () => {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(
          `[code-agent] Job exhausted retries (run ${runId}):`,
          errMsg
        );

        if (userId) {
          try {
            await refundFailedGenerationCredits({
              userId,
              chargeCorrelationId: triggerEventId
                ? `inngest_gen_charge:${triggerEventId}`
                : `inngest_gen_charge_fallback:${runId}`,
              correlationId: `inngest_gen_fail:${runId}`,
              metadata: { inngestRunId: runId, projectId },
            });
          } catch (e) {
            console.error('[code-agent] Credit refund failed:', e);
          }
        }

        if (projectId) {
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
      });
    },
  },
  async ({ event, step }) => {
    const normalizedPrompt = normalizePromptInput(event.data.value);
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
    const fragmentTitleModel = createAgentKitModel(aiConfig);
    const responseModel = createAgentKitModel(aiConfig);

    const {
      sandboxId,
      previousMessages,
      allFiles,
      contextFiles,
      graphContext,
    } = await step.run(
      'prepare-agent-session',
      async () => {
        const projectId = event.data.projectId;

        const initialFiles =
          await loadInitialAgentFilesFromLatestFragment(projectId);

        const sandboxId = await resolveOrCreateSandboxId(projectId, forceNewSession);

        await prisma.project.update({
          where: { id: projectId },
          data: { e2bSandboxId: sandboxId },
        });

        await syncSandboxFilesFromMap(sandboxId, initialFiles);
        const { context: graphContext, selectedFiles } = await syncGraphifyArtifactsToSandbox(
          sandboxId,
          initialFiles,
          normalizedPrompt
        );

        const formattedMessages: Message[] = [];
        const messages = await prisma.message.findMany({
          where: { projectId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });

        for (const message of messages) {
          formattedMessages.push({
            type: 'text',
            role: message.role === 'ASSISTANT' ? 'assistant' : 'user',
            content: message.content,
          });
        }

        return {
          sandboxId,
          previousMessages: formattedMessages.reverse(),
          allFiles: initialFiles,
          contextFiles:
            Object.keys(selectedFiles).length > 0 ? selectedFiles : initialFiles,
          graphContext,
        };
      }
    );

    const boundedMessages = boundMessagesForRateLimit(previousMessages);
    const boundedFiles = boundFilesForRateLimit(contextFiles);

    const state = createState<AgentState>(
      {
        summary: '',
        files: boundedFiles,
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
            const buffers = { stdout: '', stderr: '' };

            try {
              const sandbox = await getSandbox(sandboxId);
              const result = await sandbox.commands.run(command, {
                onStdout: (data: string) => {
                  buffers.stdout += data;
                },
                onStderr: (data: string) => {
                  buffers.stderr += data;
                },
              });
              return result.stdout;
            } catch (e) {
              console.error(
                `Command failed: ${e} \nstdout: ${buffers.stdout} \nstderror: ${buffers.stderr}`
              );
              return `Command failed: ${e} \nstdout: ${buffers.stdout} \nstderror: ${buffers.stderr}`;
            }
          },
        }),
        //createOrUpdateFiles tool
        createTool({
          name: 'createOrUpdateFiles',
          description: 'create or update files in the sandbox',
          parameters: z.object({
            files: z.array(
              z.object({
                path: z.string(),
                content: z.string(),
              })
            ),
          }),
          handler: async (
            { files },
            { network }: Tool.Options<AgentState>
          ) => {
            let newFiles: Record<string, string> | string | undefined;
            try {
              const updatedFiles = { ...(network.state.data.files || {}) };
              const sandbox = await getSandbox(sandboxId);

              for (const file of files) {
                await sandbox.files.write(file.path, file.content);
                updatedFiles[file.path] = file.content;
              }

              newFiles = updatedFiles;
            } catch (e) {
              newFiles = 'Error: ' + e;
            }

            if (newFiles && typeof newFiles === 'object') {
              network.state.data.files = newFiles;
            }
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
              const contents = [];
              for (const file of files) {
                const content = await sandbox.files.read(file);
                contents.push({ path: file, content });
              }
              return JSON.stringify(contents);
            } catch (e) {
              return 'Error: ' + e;
            }
          },
        }),
      ],
      lifecycle: {
        onResponse: async ({ result, network }) => {
          const lastAssistantMessageText =
            await lastAssistantTextMessageContent(result);

          if (lastAssistantMessageText && network) {
            if (lastAssistantMessageText.includes('<task_summary>')) {
              network.state.data.summary = lastAssistantMessageText;
            }
          }
          return result;
        },
      },
    });

    const network = createNetwork<AgentState>({
      name: 'code-agent-network',
      agents: [codeAgent],
      maxIter: 15,
      defaultState:state,
      router: async ({ network }) => {
        const summary = network.state.data.summary;
        if (summary) {
          return;
        }
        return codeAgent;
      },
    });

    type RunSuccess = {
      result: Awaited<ReturnType<typeof network.run>>;
      fragmentTitle: string;
      userResponse: string;
    };

    let runSuccess: RunSuccess | null = null;

    try {
      const estimatedInputTokens = estimateInputTokens({
        userPrompt: `${normalizedPrompt}\n\n${graphContext}`,
        systemPrompts: [PROMPT, FRAGMENT_TITLE_PROMPT, RESPONSE_PROMPT],
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
        return {
          url: '',
          title: '',
          files: {},
          summary: '',
          insufficientCredits: true as const,
          requiredCredits: creditReservation.requiredCredits,
        };
      }

      runSuccess = await (async () => {
        const runInput = `${normalizedPrompt}

<graph_context>
${graphContext}
</graph_context>`;
        const result = await network.run(runInput, { state: state });
        const safeSummary =
          (result.state.data.summary || '').trim() ||
          `Task: ${normalizedPrompt}\n\nProvide a concise summary of what was built.`;

        const fragmentTitleGenerator = createAgent({
          name: 'fragment-title-generator',
          description:
            'Generates a title for the code fragment based on the task summary',
          system: FRAGMENT_TITLE_PROMPT,
          model: fragmentTitleModel,
        });
        const responseGenerator = createAgent({
          name: 'response-generator',
          description: 'Generates a response based on the task summary',
          system: RESPONSE_PROMPT,
          model: responseModel,
        });

        const { output: fragmentTitleOutput } =
          await fragmentTitleGenerator.run(safeSummary);
        const { output: responseMessageOutput } =
          await responseGenerator.run(safeSummary);

        const parseFragmentTitle = () => {
          const output = fragmentTitleOutput[0];
          if (output.type !== 'text') {
            return 'Fragment';
          }
          if (Array.isArray(output.content)) {
            return output.content.map((txt) => txt).join('');
          }
          return output.content;
        };

        const parseResponseMessage = () => {
          const output = responseMessageOutput[0];
          if (output.type !== 'text') {
            return 'Here you go! I built a custom Next.js app based on your request. Check it out and let me know if you need any changes.';
          }
          if (Array.isArray(output.content)) {
            return output.content.map((txt) => txt).join('');
          }
          return output.content;
        };

        return {
          result,
          fragmentTitle: parseFragmentTitle(),
          userResponse: parseResponseMessage(),
        };
      })();
    } catch (err) {
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
      throw err;
    }

    const { result, fragmentTitle, userResponse } = runSuccess;

    const isError =
      !result.state.data.summary ||
      Object.keys(result.state.data.files || {}).length === 0;

    const sandboxUrl = await step.run('get-sandbox-url', async () => {
      const sandbox = await getSandbox(sandboxId);
      const host = sandbox.getHost(3000);
      return `https://${host}`;
    });

    await step.run('save-result', async () => {
      if (isError) {
        return prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content: 'Something went wrong. Please try again later',
            role: 'ASSISTANT',
            type: 'ERROR',
          },
        });
      }

      const sandboxFiles = await snapshotSandboxProjectFiles(sandboxId);
      const mergedFiles = {
        ...allFiles,
        ...(result.state.data.files || {}),
        ...sandboxFiles,
      };

      return prisma.message.create({
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
    });

    return {
      url: sandboxUrl,
      title: 'Fragment',
      files: {
        ...allFiles,
        ...(result.state.data.files || {}),
      },
      summary: result.state.data.summary,
    };
  }
);
