import 'server-only';

import { prisma } from '@/lib/db';
import {
  normalizeFragmentFiles,
  syncFragmentFilesToSandboxPreview,
} from '@/lib/sync-fragment-files-to-sandbox';
import { resolveOrCreateSandboxId, waitForSandboxPreviewReady } from '@/inngest/project-sandbox';

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
  const mergedFiles = normalizeFragmentFiles(fragmentFilesToRecord(files));
  const { sandboxUrl } = await syncFragmentFilesToSandboxPreview(
    projectId,
    mergedFiles
  );

  const sandboxId = await resolveOrCreateSandboxId(projectId);
  await waitForSandboxPreviewReady(sandboxId, 90_000);

  await prisma.project.update({
    where: { id: projectId },
    data: { e2bSandboxId: sandboxId },
  });

  return { sandboxUrl, files: mergedFiles };
}
