import 'server-only';

import { Sandbox } from '@e2b/code-interpreter';

import { ensureAppPageForPreview } from '@/inngest/auto-wire-page';
import { ensureSandboxBootstrapFiles } from '@/inngest/sandbox-bootstrap';
import {
  loadInitialAgentFilesFromLatestFragment,
  prepareSandboxPreview,
  resolveOrCreateSandboxId,
  syncSandboxFilesFromMap,
} from '@/inngest/project-sandbox';
import { prisma } from '@/lib/db';

export type ReviveProjectSandboxResult = {
  sandboxId: string;
  sandboxPreviewUrl: string;
  previewReady: boolean;
};

export type ReviveProjectSandboxOptions = {
  /** Manual refresh: sync files then restart dev server if needed. */
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
  await ensureAppPageForPreview({
    sandboxId,
    userPrompt: 'App preview',
  });

  const { ready: previewReady } = await prepareSandboxPreview(sandboxId, {
    maxWaitMs: 45_000,
    forceRestart: options?.forceRestart,
  });

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

  return { sandboxId, sandboxPreviewUrl, previewReady };
}
