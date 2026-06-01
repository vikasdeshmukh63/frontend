import 'server-only';

import { Sandbox } from '@e2b/code-interpreter';

import { ensureSandboxBootstrapFiles } from '@/inngest/sandbox-bootstrap';
import {
  loadInitialAgentFilesFromLatestFragment,
  refreshSandboxDevServer,
  resolveOrCreateSandboxId,
  syncSandboxFilesFromMap,
  waitForSandboxPreviewReady,
} from '@/inngest/project-sandbox';
import { prisma } from '@/lib/db';

export type ReviveProjectSandboxResult = {
  sandboxId: string;
  sandboxPreviewUrl: string;
  previewReady: boolean;
};

/**
 * Reconnects or recreates the E2B sandbox, syncs the latest fragment files,
 * starts the dev server, and returns a fresh preview URL for the demo iframe.
 */
export async function reviveProjectSandbox(
  projectId: string
): Promise<ReviveProjectSandboxResult> {
  const sandboxId = await resolveOrCreateSandboxId(projectId);
  const latestFiles = await loadInitialAgentFilesFromLatestFragment(projectId);

  if (Object.keys(latestFiles).length > 0) {
    await syncSandboxFilesFromMap(sandboxId, latestFiles);
  }

  await ensureSandboxBootstrapFiles(sandboxId);
  await refreshSandboxDevServer(sandboxId);
  const { ready: previewReady } = await waitForSandboxPreviewReady(
    sandboxId,
    120_000
  );

  const sandbox = await Sandbox.connect(sandboxId);
  const sandboxPreviewUrl = `https://${sandbox.getHost(3000)}`;

  await prisma.$transaction([
    prisma.project.update({
      where: { id: projectId },
      data: { e2bSandboxId: sandboxId },
    }),
    prisma.fragment.updateMany({
      where: {
        message: { projectId },
      },
      data: { sandboxUrl: sandboxPreviewUrl },
    }),
  ]);

  return { sandboxId, sandboxPreviewUrl, previewReady };
}
