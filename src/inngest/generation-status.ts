import { prisma } from '@/lib/db';
import {
  formatGenerationStatus,
  GENERATION_STATUS_PREFIX,
} from '@/lib/generation-status';
import {
  defaultGenerationProgress,
  generationProgressToJson,
  parseGenerationProgress,
  stepIdFromLabel,
  type GenerationProgress,
} from '@/lib/generation-progress';

export { GENERATION_STATUS_PREFIX, isGenerationStatusMessage } from '@/lib/generation-status';

export async function createGenerationStatusMessage(
  projectId: string,
  progress?: GenerationProgress
) {
  const body = progress ?? defaultGenerationProgress('Preparing your project…');
  return prisma.message.create({
    data: {
      projectId,
      content: formatGenerationStatus(generationProgressToJson(body)),
      role: 'ASSISTANT',
      type: 'RESULT',
    },
  });
}

export async function setGenerationProgress(
  messageId: string,
  progress: GenerationProgress
) {
  return prisma.message.update({
    where: { id: messageId },
    data: { content: formatGenerationStatus(generationProgressToJson(progress)) },
  });
}

export async function updateGenerationStatusMessage(
  messageId: string,
  text: string
) {
  return setGenerationProgress(
    messageId,
    defaultGenerationProgress(text)
  );
}

export async function updateGenerationHeadline(
  messageId: string,
  headline: string
) {
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { content: true },
  });
  if (!msg) return;

  const prev =
    parseGenerationProgress(msg.content) ??
    defaultGenerationProgress(headline);

  await setGenerationProgress(messageId, {
    ...prev,
    headline,
  });
}

const MAX_LIVE_FILE_CHARS = 10_000;
const MAX_TRACKED_LIVE_FILES = 40;

function truncateLiveFileContent(content: string): string {
  if (content.length <= MAX_LIVE_FILE_CHARS) return content;
  return `${content.slice(0, MAX_LIVE_FILE_CHARS)}\n\n/* … truncated for live preview */`;
}

/** Stream a file write into the status message for real-time UI preview. */
export async function pushGenerationCodeFile(
  messageId: string,
  path: string,
  content: string,
  options?: { headline?: string }
) {
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { content: true },
  });
  if (!msg) return;

  const prev =
    parseGenerationProgress(msg.content) ??
    defaultGenerationProgress('Generating your app…');

  const rel = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const truncated = truncateLiveFileContent(content);

  const files = { ...(prev.files ?? {}), [rel]: truncated };
  let fileOrder = [...(prev.fileOrder ?? Object.keys(prev.files ?? {}))];
  fileOrder = fileOrder.filter((p) => p !== rel);
  fileOrder.push(rel);

  while (fileOrder.length > MAX_TRACKED_LIVE_FILES) {
    const removed = fileOrder.shift();
    if (removed) delete files[removed];
  }

  const steps = prev.steps.map((s) =>
    s.status === 'running' ? { ...s, status: 'done' as const } : s
  );
  const writeLabel = `Wrote ${rel}`;
  const writeStepId = stepIdFromLabel(writeLabel);
  const withoutDup = steps.filter((s) => s.id !== writeStepId);
  withoutDup.push({ id: writeStepId, label: writeLabel, status: 'running' });

  await setGenerationProgress(messageId, {
    ...prev,
    headline: options?.headline ?? `Writing ${rel}…`,
    steps: withoutDup.slice(-24),
    activeFile: { path: rel, content: truncated },
    files,
    fileOrder,
  });
}

export async function pushGenerationStep(
  messageId: string,
  label: string,
  options?: { headline?: string; markPreviousDone?: boolean }
) {
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { content: true },
  });
  if (!msg) return;

  const prev =
    parseGenerationProgress(msg.content) ??
    defaultGenerationProgress('Building…');

  const steps = prev.steps.map((s) =>
    s.status === 'running' && options?.markPreviousDone !== false
      ? { ...s, status: 'done' as const }
      : s
  );

  const id = stepIdFromLabel(label);
  const withoutDup = steps.filter((s) => s.id !== id);
  withoutDup.push({ id, label, status: 'running' });

  const capped = withoutDup.slice(-24);

  await setGenerationProgress(messageId, {
    ...prev,
    headline: options?.headline ?? prev.headline,
    steps: capped,
  });
}

export async function completeGenerationSteps(messageId: string, headline: string) {
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { content: true },
  });
  if (!msg) return;

  const prev =
    parseGenerationProgress(msg.content) ??
    defaultGenerationProgress(headline);

  await setGenerationProgress(messageId, {
    ...prev,
    headline,
    steps: prev.steps.map((s) => ({ ...s, status: 'done' as const })),
  });
}

export async function deleteGenerationStatusMessage(
  messageId: string | undefined
) {
  if (!messageId) return;
  try {
    await prisma.message.delete({ where: { id: messageId } });
  } catch {
    // Already removed or missing.
  }
}

/** Remove every in-flight status row for a project (prevents stuck UI loaders). */
export async function clearAllGenerationStatusMessages(projectId: string) {
  await prisma.message.deleteMany({
    where: {
      projectId,
      role: 'ASSISTANT',
      content: { startsWith: GENERATION_STATUS_PREFIX },
    },
  });
}

/** Keeps `updatedAt` fresh so idle detection does not treat an active run as dead. */
export async function touchGenerationStatus(messageId: string) {
  const msg = await prisma.message.findUnique({
    where: { id: messageId },
    select: { content: true },
  });
  if (!msg?.content.startsWith(GENERATION_STATUS_PREFIX)) return;

  await prisma.message.update({
    where: { id: messageId },
    data: { content: msg.content },
  });
}
