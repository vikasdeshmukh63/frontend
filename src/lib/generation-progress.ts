import { parseGenerationStatus } from '@/lib/generation-status';

export type GenerationStepStatus = 'running' | 'done';

export type GenerationStep = {
  id: string;
  label: string;
  status: GenerationStepStatus;
};

export type GenerationProgress = {
  headline: string;
  steps: GenerationStep[];
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
      return parsed;
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
