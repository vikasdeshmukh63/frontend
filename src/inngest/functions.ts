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
} from '@/inngest/project-sandbox';

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

export const codeAgentFunction = inngest.createFunction(
  { id: 'code-agent-v2', triggers: [{ event: 'code-agent/run' }] },
  async ({ event, step }) => {
    const normalizedPrompt = normalizePromptInput(event.data.value);
    const userId =
      typeof event.data.userId === 'string' ? event.data.userId : undefined;

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

        const sandboxId = await resolveOrCreateSandboxId(projectId);

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
              files: {
                ...allFiles,
                ...(result.state.data.files || {}),
              },
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
