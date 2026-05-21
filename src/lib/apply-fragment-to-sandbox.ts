import 'server-only';

import { Sandbox } from '@e2b/code-interpreter';

import { prisma } from '@/lib/db';
import { mergeBootstrapIntoFileMap } from '@/inngest/sandbox-bootstrap';
import {
  refreshSandboxDevServer,
  resolveOrCreateSandboxId,
  syncSandboxFilesFromMap,
  waitForSandboxPreviewReady,
} from '@/inngest/project-sandbox';

function fragmentFilesToRecord(files: unknown): Record<string, string> {
  if (!files || typeof files !== 'object' || Array.isArray(files)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files as Record<string, unknown>)) {
    if (typeof v === 'string') out[k.replace(/^\/+/, '')] = v;
  }
  return out;
}

/**
 * Writes a saved fragment's files into the project's live E2B sandbox and waits
 * for the dev preview to reflect them (used on revert).
 */
export async function applyFragmentToProjectSandbox(
  projectId: string,
  files: unknown
): Promise<{ sandboxUrl: string; files: Record<string, string> }> {
  const sandboxId = await resolveOrCreateSandboxId(projectId);
  const mergedFiles = mergeBootstrapIntoFileMap(fragmentFilesToRecord(files));

  await syncSandboxFilesFromMap(sandboxId, mergedFiles);
  await refreshSandboxDevServer(sandboxId);
  await waitForSandboxPreviewReady(sandboxId, 90_000);

  const sandbox = await Sandbox.connect(sandboxId);
  const sandboxUrl = `https://${sandbox.getHost(3000)}`;

  await prisma.project.update({
    where: { id: projectId },
    data: { e2bSandboxId: sandboxId },
  });

  return { sandboxUrl, files: mergedFiles };
}
