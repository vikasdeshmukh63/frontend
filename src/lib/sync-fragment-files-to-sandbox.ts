import 'server-only';

import { Sandbox } from '@e2b/code-interpreter';

import { ensureAppPageForPreview } from '@/inngest/auto-wire-page';
import { repairMissingLocalImports } from '@/inngest/import-resolution';
import { prisma } from '@/lib/db';
import { mergeBootstrapIntoFileMap } from '@/inngest/sandbox-bootstrap';
import { ensureSandboxBootstrapFiles } from '@/inngest/sandbox-bootstrap';
import {
  quickPrepareSandboxPreview,
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
 * Pushes file map to the project sandbox, repairs imports, and nudges preview.
 */
export async function syncFragmentFilesToSandboxPreview(
  projectId: string,
  files: Record<string, string>
): Promise<{ sandboxUrl: string; files: Record<string, string>; previewReady: boolean }> {
  const sandboxId = await resolveOrCreateSandboxId(projectId);
  const mergedFiles = normalizeFragmentFiles(files);

  await syncSandboxFilesFromMap(sandboxId, mergedFiles);
  await ensureSandboxBootstrapFiles(sandboxId);
  await repairMissingLocalImports(sandboxId);
  await ensureAppPageForPreview({
    sandboxId,
    userPrompt: 'App preview',
  });

  const { ready: previewReady } = await quickPrepareSandboxPreview(sandboxId, 15_000);

  const sandbox = await Sandbox.connect(sandboxId);
  const sandboxUrl = `https://${sandbox.getHost(3000)}`;

  await prisma.project.update({
    where: { id: projectId },
    data: { e2bSandboxId: sandboxId },
  });

  return { sandboxUrl, files: mergedFiles, previewReady };
}
