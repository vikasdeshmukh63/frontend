import {
  createAgent,
  createNetwork,
  createState,
  createTool,
  Message,
  type Tool,
} from '@inngest/agent-kit';
import { inngest } from './client';
import { Sandbox } from '@e2b/code-interpreter';
import { getSandbox, lastAssistantTextMessageContent } from './utils';
import { z } from 'zod';
import { FRAGMENT_TITLE_PROMPT, PROMPT, RESPONSE_PROMPT } from '@/prompt';
import { prisma } from '@/lib/db';
import { SANDBOX_TIMEOUT } from './types';
import {
  createAgentKitModel,
  getUserAiRuntimeConfig,
} from '@/lib/ai-model-factory';
import {
  AI_RATE_LIMIT_USER_MESSAGE,
  isProviderRateLimitError,
} from '@/inngest/ai-error-utils';
import { randomUUID } from 'node:crypto';

interface AgentState {
  summary: string;
  files: { [path: string]: string };
}

export const codeAgentFunction = inngest.createFunction(
  { id: 'code-agent', triggers: [{ event: 'code-agent/run' }] },
  async ({ event, step }) => {
    const aiConfig = await step.run('load-ai-settings', async () => {
      const userId =
        typeof event.data.userId === 'string' ? event.data.userId : undefined;
      return getUserAiRuntimeConfig(userId);
    });

    const primaryModel = createAgentKitModel(aiConfig);
    const fragmentTitleModel = createAgentKitModel(aiConfig);
    const responseModel = createAgentKitModel(aiConfig);

    const sandboxId = await step.run('get-sandbox-id', async () => {
      const sandbox = await Sandbox.create('vikasdeshmukh63/vibe-nextjs-test1');
      await sandbox.setTimeout(SANDBOX_TIMEOUT)
      return sandbox.sandboxId;
    });

    const previousMessages = await step.run('get-previous-messages', async () => {
      const formattedMessages: Message[] = []

      const messages = await prisma.message.findMany({
        where: {
          projectId: event.data.projectId,
        },
        orderBy: {
          createdAt: 'desc' // todo change to asc if ai does not understand what is the latest message
        },
        take: 10,
      })

      for (const message of messages) {
        formattedMessages.push({
          type: "text",
          role: message.role === "ASSISTANT" ? "assistant" : "user",
          content: message.content
        })
      }

      return formattedMessages.reverse()
    })

    const state = createState<AgentState>(
      {
        summary: '',
        files: {},
      },
      {
        messages: previousMessages
      })

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
          handler: async ({ command }, { step }) => {
            const stepId = `terminal-${randomUUID()}`;
            return await step?.run(stepId, async () => {
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
            });
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
            { step, network }: Tool.Options<AgentState>
          ) => {
            const stepId = `createOrUpdateFiles-${randomUUID()}`;
            const newFiles = await step?.run(stepId, async () => {
                try {
                  const updatedFiles = network.state.data.files || {};
                  const sandbox = await getSandbox(sandboxId);

                  for (const file of files) {
                    await sandbox.files.write(file.path, file.content);
                    updatedFiles[file.path] = file.content;
                  }

                  return updatedFiles;
                } catch (e) {
                  return 'Error: ' + e;
                }
            });

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
          handler: async ({ files }, { step }) => {
            const stepId = `readFiles-${randomUUID()}`;
            return await step?.run(stepId, async () => {
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
            });
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
      const result = await network.run(event.data.value, { state: state });

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

      const { output: fragmentTitleOutput } = await fragmentTitleGenerator.run(
        result.state.data.summary
      );
      const { output: responseMessageOutput } = await responseGenerator.run(
        result.state.data.summary
      );

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

      runSuccess = {
        result,
        fragmentTitle: parseFragmentTitle(),
        userResponse: parseResponseMessage(),
      };
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
              files: result.state.data.files,
            },
          },
        },
      });
    });

    return {
      url: sandboxUrl,
      title: 'Fragment',
      files: result.state.data.files,
      summary: result.state.data.summary,
    };
  }
);
