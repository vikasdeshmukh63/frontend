import 'server-only';

import { Sandbox } from '@e2b/code-interpreter';

import { ensureAppPageForPreview } from '@/inngest/auto-wire-page';
import { repairMissingLocalImports } from '@/inngest/import-resolution';
import { ensureSandboxBootstrapFiles } from '@/inngest/sandbox-bootstrap';
import {
  loadInitialAgentFilesFromLatestFragment,
  quickPrepareSandboxPreview,
  resolveOrCreateSandboxId,
  restartSandboxDevServer,
  syncSandboxFilesFromMap,
} from '@/inngest/project-sandbox';
import { prisma } from '@/lib/db';

export type ReviveProjectSandboxResult = {
  sandboxId: string;
  sandboxPreviewUrl: string;
  previewReady: boolean;
};

export type ReviveProjectSandboxOptions = {
  /** Hard restart: kill dev server, clear .next, start fresh. */
  forceRestart?: boolean;
};

/**
 * Reconnects or recreates the E2B sandbox, syncs the latest fragment files,
 * wires app/page.tsx, nudges the dev server, and returns a fresh preview URL.
 */
export async function reviveProjectSandbox(
  projectId: string,
  options?: ReviveProjectSandboxOptions
): Promise<ReviveProjectSandboxResult> {
  const sandboxId = await resolveOrCreateSandboxId(projectId);
  const latestFiles = await loadInitialAgentFilesFromLatestFragment(projectId);

  if (Object.keys(latestFiles).length > 0) {
    await syncSandboxFilesFromMap(sandboxId, latestFiles);
  }

  await ensureSandboxBootstrapFiles(sandboxId);
  await repairMissingLocalImports(sandboxId);
  await ensureAppPageForPreview({
    sandboxId,
    userPrompt: 'App preview',
  });

  let previewReady = false;
  let httpCode = '000';

  if (options?.forceRestart) {
    const result = await restartSandboxDevServer(sandboxId, 45_000);
    previewReady = result.ready;
    httpCode = result.httpCode;
  } else {
    let result = await quickPrepareSandboxPreview(sandboxId, 20_000);
    if (!result.ready && result.httpCode === '000') {
      result = await restartSandboxDevServer(sandboxId, 45_000);
    }
    previewReady = result.ready;
    httpCode = result.httpCode;
  }

  const sandbox = await Sandbox.connect(sandboxId);
  const sandboxPreviewUrl = `https://${sandbox.getHost(3000)}`;

  try {
    await prisma.project.update({
      where: { id: projectId },
      data: { e2bSandboxId: sandboxId },
    });
  } catch (e) {
    console.warn('[reviveProjectSandbox] project update failed:', e);
  }

  try {
    await prisma.fragment.updateMany({
      where: {
        message: { projectId },
      },
      data: { sandboxUrl: sandboxPreviewUrl },
    });
  } catch (e) {
    console.warn('[reviveProjectSandbox] fragment update failed:', e);
  }

  return {
    sandboxId,
    sandboxPreviewUrl,
    previewReady:
      previewReady || httpCode === '200' || httpCode === '304',
  };
}
