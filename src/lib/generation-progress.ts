import { parseGenerationStatus } from '@/lib/generation-status';

export type GenerationStepStatus = 'running' | 'done';

export type GenerationStep = {
  id: string;
  label: string;
  status: GenerationStepStatus;
};

export type GenerationLiveFile = {
  path: string;
  content: string;
};

export type GenerationProgress = {
  headline: string;
  steps: GenerationStep[];
  /** File currently being written (shown in live preview). */
  activeFile?: GenerationLiveFile | null;
  /** Files written so far this run (truncated for DB size). */
  files?: Record<string, string>;
  /** Write order for file tree / auto-select latest. */
  fileOrder?: string[];
};

export function defaultGenerationProgress(
  headline = 'Starting build…'
): GenerationProgress {
  return { headline, steps: [] };
}

export function parseGenerationProgress(
  content: string
): GenerationProgress | null {
  const raw = parseGenerationStatus(content);
  try {
    const parsed = JSON.parse(raw) as GenerationProgress;
    if (
      parsed &&
      typeof parsed.headline === 'string' &&
      Array.isArray(parsed.steps)
    ) {
      return {
        headline: parsed.headline,
        steps: parsed.steps,
        activeFile:
          parsed.activeFile &&
          typeof parsed.activeFile.path === 'string' &&
          typeof parsed.activeFile.content === 'string'
            ? parsed.activeFile
            : undefined,
        files:
          parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files)
            ? (parsed.files as Record<string, string>)
            : undefined,
        fileOrder: Array.isArray(parsed.fileOrder)
          ? parsed.fileOrder.filter((p): p is string => typeof p === 'string')
          : undefined,
      };
    }
  } catch {
    /* legacy plain-text status */
  }
  return null;
}

export function generationProgressToJson(progress: GenerationProgress): string {
  return JSON.stringify(progress);
}

export function stepIdFromLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 80);
}
