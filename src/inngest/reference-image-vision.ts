import 'server-only';

import type { UserAiRuntimeConfig } from '@/lib/ai-model-factory';
import { resolveActiveProviderApiKey } from '@/lib/ai-model-factory';
import { getStoredObject } from '@/lib/object-storage';
import {
  classifyReferenceImageIntent,
  type ReferenceImageIntent,
  type ResolvedReferenceImage,
} from '@/inngest/reference-images';

const MAX_IMAGES_TO_ANALYZE = 2;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

type LoadedReferenceImage = {
  fileName: string;
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
};

function normalizeMediaType(
  value: string | undefined
): LoadedReferenceImage['mediaType'] | null {
  const t = (value ?? '').split(';')[0]?.trim().toLowerCase();
  if (
    t === 'image/jpeg' ||
    t === 'image/png' ||
    t === 'image/gif' ||
    t === 'image/webp'
  ) {
    return t;
  }
  return null;
}

function visionModelForProvider(config: UserAiRuntimeConfig): string {
  const model = config.apiModel.toLowerCase();
  switch (config.provider) {
    case 'OPENAI':
      if (
        model.includes('gpt-4o') ||
        model.includes('gpt-4.1') ||
        model.includes('gpt-5')
      ) {
        return config.apiModel;
      }
      return 'gpt-4o';
    case 'ANTHROPIC':
      if (model.includes('claude')) return config.apiModel;
      return 'claude-sonnet-4-20250514';
    case 'GOOGLE_GEMINI':
      if (model.includes('gemini')) return config.apiModel;
      return 'gemini-2.0-flash';
  }
}

const VISION_ANALYSIS_INSTRUCTION = (
  userPrompt: string,
  intent: ReferenceImageIntent
) => `You analyze UI mockup screenshots for a coding agent building production-grade Next.js apps (Tailwind + Shadcn). Target quality: Bolt.new, Lovable, Base44.

User request: ${userPrompt || '(build from the attached image)'}
Interpretation: ${intent === 'design_reference' ? 'Recreate this UI in code at premium SaaS quality.' : 'Infer embed vs rebuild; full-page app screenshots should be rebuilt in code.'}

Produce a **build spec** detailed enough that a senior frontend dev could match the design without seeing the image:

## Layout & shell
- App shell type (sidebar dashboard, top nav, split view, marketing page)
- Exact regions: sidebar width estimate, header height, content padding, footer
- Grid structure (e.g. 4-col KPI row, 2-col below, full-width table)

## Visual design tokens (map to Tailwind/Shadcn)
- Background layers (page bg, card bg, sidebar bg, muted sections)
- Primary/accent color role (buttons, active nav, links)
- Border radius feel (sharp vs rounded-lg)
- Shadow/elevation (flat vs card shadow-sm)
- Dark sidebar vs light content (common in dashboards)

## Typography
- Page title, section headers, labels, table text, muted helper text

## Components (enumerate every visible block)
- KPI/stat cards: count, labels, trend indicators
- Charts (describe type: line/bar/donut — use placeholder if no chart lib)
- Tables: columns, sample row data, badges for status
- Nav items with icons, search bars, filters, CTAs, avatars, dropdowns
- Empty states if shown

## Mock content
- Suggest 3–5 realistic labels, numbers, names, dates matching the domain

## Interactions implied
- Tabs, toggles, hover states, primary/secondary buttons

Rules:
- Do NOT say "show the screenshot in an img tag" for full UI mockups.
- Be pixel-level specific (e.g. "left sidebar ~240px bg-zinc-950 text-zinc-100, 8 nav items with Lucide icons").
- If the image is only a logo/photo asset, output **EMBED_ONLY** and placement — not a full spec.`;

export function shouldAnalyzeReferenceImages(
  intent: ReferenceImageIntent,
  imageCount: number
): boolean {
  if (imageCount === 0) return false;
  if (intent === 'embed_asset') return false;
  return true;
}

async function loadReferenceImage(
  image: ResolvedReferenceImage & { storageKey?: string }
): Promise<LoadedReferenceImage | null> {
  let bytes: Buffer | null = null;
  let mediaType: LoadedReferenceImage['mediaType'] | null = null;

  if (image.storageKey?.trim()) {
    try {
      const stored = await getStoredObject(image.storageKey.trim());
      mediaType = normalizeMediaType(stored.contentType);
      bytes = Buffer.from(stored.body);
    } catch (e) {
      console.warn('[reference-image-vision] S3 read failed:', image.fileName, e);
    }
  }

  if (!bytes) {
    try {
      const res = await fetch(image.publicUrl, { cache: 'no-store' });
      if (!res.ok) {
        console.warn(
          `[reference-image-vision] fetch failed HTTP ${res.status}:`,
          image.publicUrl
        );
        return null;
      }
      mediaType = normalizeMediaType(res.headers.get('content-type') ?? undefined);
      bytes = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      console.warn('[reference-image-vision] fetch failed:', image.publicUrl, e);
      return null;
    }
  }

  if (!bytes?.length || bytes.length > MAX_IMAGE_BYTES) return null;
  if (!mediaType) {
    const lower = image.fileName.toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mediaType = 'image/jpeg';
    else if (lower.endsWith('.gif')) mediaType = 'image/gif';
    else if (lower.endsWith('.webp')) mediaType = 'image/webp';
    else mediaType = 'image/png';
  }

  return {
    fileName: image.fileName,
    base64: bytes.toString('base64'),
    mediaType,
  };
}

async function analyzeWithOpenAI(
  apiKey: string,
  model: string,
  instruction: string,
  images: LoadedReferenceImage[]
): Promise<string> {
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail: 'high' } }
  > = [
    { type: 'text', text: instruction },
    ...images.map((img) => ({
      type: 'image_url' as const,
      image_url: {
        url: `data:${img.mediaType};base64,${img.base64}`,
        detail: 'high' as const,
      },
    })),
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      max_completion_tokens: 6144,
      temperature: 0.2,
    }),
  });

  const data = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `OpenAI vision HTTP ${res.status}`);
  }
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

async function analyzeWithAnthropic(
  apiKey: string,
  model: string,
  instruction: string,
  images: LoadedReferenceImage[]
): Promise<string> {
  const content: Array<
    | { type: 'text'; text: string }
    | {
        type: 'image';
        source: {
          type: 'base64';
          media_type: LoadedReferenceImage['mediaType'];
          data: string;
        };
      }
  > = [
    ...images.map((img) => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: img.mediaType,
        data: img.base64,
      },
    })),
    { type: 'text' as const, text: instruction },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 6144,
      temperature: 0.2,
      messages: [{ role: 'user', content }],
    }),
  });

  const data = (await res.json()) as {
    error?: { message?: string };
    content?: Array<{ type: string; text?: string }>;
  };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Anthropic vision HTTP ${res.status}`);
  }
  return (
    data.content
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n')
      .trim() ?? ''
  );
}

async function analyzeWithGemini(
  apiKey: string,
  model: string,
  instruction: string,
  images: LoadedReferenceImage[]
): Promise<string> {
  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [
    { text: instruction },
    ...images.map((img) => ({
      inlineData: { mimeType: img.mediaType, data: img.base64 },
    })),
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationConfig: { temperature: 0.2, maxOutputTokens: 6144 },
        contents: [{ role: 'user', parts }],
      }),
    }
  );

  const data = (await res.json()) as {
    error?: { message?: string };
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Gemini vision HTTP ${res.status}`);
  }
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('\n')
      .trim() ?? ''
  );
}

/**
 * Uses a vision-capable model to turn attached screenshots into a text spec the
 * code agent can follow (agent-kit does not pass raw images to the coding model).
 */
export async function analyzeReferenceImagesForAgent(params: {
  images: Array<ResolvedReferenceImage & { storageKey?: string }>;
  userPrompt: string;
  aiConfig: UserAiRuntimeConfig;
}): Promise<string> {
  const intent = classifyReferenceImageIntent(params.userPrompt);
  if (!shouldAnalyzeReferenceImages(intent, params.images.length)) {
    return '';
  }

  const apiKey = resolveActiveProviderApiKey(params.aiConfig);
  if (!apiKey) {
    console.warn('[reference-image-vision] No API key for vision analysis');
    return '';
  }

  const loaded: LoadedReferenceImage[] = [];
  for (const image of params.images.slice(0, MAX_IMAGES_TO_ANALYZE)) {
    const item = await loadReferenceImage(image);
    if (item) loaded.push(item);
  }
  if (loaded.length === 0) {
    console.warn('[reference-image-vision] Could not load any reference images');
    return '';
  }

  const instruction = VISION_ANALYSIS_INSTRUCTION(params.userPrompt, intent);
  const model = visionModelForProvider(params.aiConfig);

  try {
    switch (params.aiConfig.provider) {
      case 'OPENAI':
        return await analyzeWithOpenAI(apiKey, model, instruction, loaded);
      case 'ANTHROPIC':
        return await analyzeWithAnthropic(apiKey, model, instruction, loaded);
      case 'GOOGLE_GEMINI':
        return await analyzeWithGemini(apiKey, model, instruction, loaded);
    }
  } catch (e) {
    console.error('[reference-image-vision] analysis failed:', e);
    return '';
  }
}
