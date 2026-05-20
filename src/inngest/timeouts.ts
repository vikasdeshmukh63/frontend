import type { Sandbox } from '@e2b/code-interpreter';

export class AgentRunTimeoutError extends Error {
  readonly code = 'AGENT_RUN_TIMEOUT';

  constructor(message: string) {
    super(message);
    this.name = 'AgentRunTimeoutError';
  }
}

export class SandboxCommandTimeoutError extends Error {
  readonly code = 'SANDBOX_COMMAND_TIMEOUT';

  constructor(message: string) {
    super(message);
    this.name = 'SandboxCommandTimeoutError';
  }
}

function readEnvMs(name: string, defaultMs: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultMs;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return defaultMs;
  return n;
}

/** Max wall time for the full agent network (LLM + tools). Default 10 minutes. */
export function codeAgentRunTimeoutMs(): number {
  return readEnvMs('CODE_AGENT_RUN_TIMEOUT_MS', 10 * 60 * 1000);
}

/** Stop routing new agent rounds this many ms before the hard network timeout. */
export function codeAgentSoftStopBeforeTimeoutMs(): number {
  return readEnvMs('CODE_AGENT_SOFT_STOP_BUFFER_MS', 90 * 1000);
}

/** Per sandbox shell command. Default 90 seconds. */
export function sandboxCommandTimeoutMs(): number {
  return readEnvMs('SANDBOX_COMMAND_TIMEOUT_MS', 90 * 1000);
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AgentRunTimeoutError(`${label} timed out after ${Math.round(ms / 1000)}s`)
      );
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

type CommandRunOptions = {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  timeoutMs?: number;
};

/** E2B throws this when `commands.run` exits non-zero (see `e2b` CommandExitError). */
export function isSandboxCommandExitError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'CommandExitError'
  );
}

export async function runSandboxCommand(
  sandbox: Sandbox,
  command: string,
  options?: CommandRunOptions
) {
  const timeoutMs = options?.timeoutMs ?? sandboxCommandTimeoutMs();
  try {
    return await withTimeout(
      sandbox.commands.run(command, {
        onStdout: options?.onStdout,
        onStderr: options?.onStderr,
      }),
      timeoutMs,
      `sandbox: ${command.slice(0, 120)}`
    );
  } catch (error) {
    if (error instanceof AgentRunTimeoutError) {
      throw new SandboxCommandTimeoutError(error.message);
    }
    throw error;
  }
}
