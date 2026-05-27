import 'server-only';

import { Sandbox } from '@e2b/code-interpreter';

import { prisma } from '@/lib/db';
import { mergeBootstrapIntoFileMap } from '@/inngest/sandbox-bootstrap';
import {
  refreshSandboxDevServer,
  resolveOrCreateSandboxId,
  syncSandboxFilesFromMap,
} from '@/inngest/project-sandbox';

export function normalizeFragmentFiles(
  files: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) {
    out[k.replace(/^\/+/, '')] = v;
  }
  return mergeBootstrapIntoFileMap(out);
}

/**
 * Pushes file map to the project sandbox and nudges the dev server (fast path for live edits).
 */
export async function syncFragmentFilesToSandboxPreview(
  projectId: string,
  files: Record<string, string>
): Promise<{ sandboxUrl: string; files: Record<string, string> }> {
  const sandboxId = await resolveOrCreateSandboxId(projectId);
  const mergedFiles = normalizeFragmentFiles(files);

  await syncSandboxFilesFromMap(sandboxId, mergedFiles);
  await refreshSandboxDevServer(sandboxId);

  const sandbox = await Sandbox.connect(sandboxId);
  const sandboxUrl = `https://${sandbox.getHost(3000)}`;

  await prisma.project.update({
    where: { id: projectId },
    data: { e2bSandboxId: sandboxId },
  });

  return { sandboxUrl, files: mergedFiles };
}
