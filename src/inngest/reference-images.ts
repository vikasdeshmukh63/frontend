import { buildAttachmentPublicUrl } from '@/lib/object-storage';

export type ReferenceImageInput = {
  fileName: string;
  storageKey: string;
  publicUrl?: string;
};

export type ResolvedReferenceImage = {
  fileName: string;
  /** https://1015.objects.excloud.dev/public/vibe/users/.../projects/.../{id}.png */
  publicUrl: string;
};

/** How the user wants attached image(s) used — inferred from their message. */
export type ReferenceImageIntent =
  | 'embed_asset'
  | 'design_reference'
  | 'infer_from_prompt';

const DESIGN_REFERENCE_RE =
  /\b(this type of|like this|ui like this|similar to|same as|recreate|replicate|clone|copy this design|match this design|match this layout|based on (this|the) (image|screenshot|mockup|design|dashboard|ui|layout)|build (this|a) (kind|type) of|create (this|a) (kind|type) of|make (this|a) (kind|type) of|as shown in (the )?(image|screenshot|mockup)|from the (image|screenshot|mockup|reference)|use (this|the|it) as (a )?reference|as (a )?reference (to|for) (build|create|design|make)|reference (to|for) (build|create|design|make|ui)|inspired by (this|the) (image|design|screenshot|mockup)|ui (like|based on) (this|the)|design (like|based on) (this|the)|want.{0,40}(ui|dashboard|layout|design).{0,20}like (this|that|the image))\b/i;

const EMBED_ASSET_RE =
  /\b(add|put|include|insert|display|show|attach|place|use|uploaded|attached)\b.{0,48}\b(this|the|that|my)?\s*(image|photo|picture|screenshot|logo|banner|hero|icon|avatar|graphic)\b|\b(this|the|attached|uploaded)\s+(image|photo|picture|screenshot)\b.{0,40}\b(on|in|into|to|inside)\b.{0,24}\b(site|page|website|webpage|app|header|footer|hero|banner|sidebar|layout|section|background)\b|\b(as|for)\s+(the\s+)?(logo|hero|banner|background|thumbnail|avatar|cover|product photo|profile photo)\b|\buse (this|the) (image|photo|picture|url)\b(?!.{0,30}\breference\b)/i;

/**
 * Classify whether the user wants to embed the file vs recreate UI from a mockup.
 * When unclear, returns infer_from_prompt so the model reads the full message.
 */
export function classifyReferenceImageIntent(
  userPrompt: string
): ReferenceImageIntent {
  const t = userPrompt.trim();
  if (!t) return 'infer_from_prompt';

  const wantsDesign = DESIGN_REFERENCE_RE.test(t);
  const wantsEmbed = EMBED_ASSET_RE.test(t);

  if (wantsDesign && !wantsEmbed) return 'design_reference';
  if (wantsEmbed && !wantsDesign) return 'embed_asset';

  if (wantsDesign && wantsEmbed) {
    if (
      /\b(use|add|put|include|display|show).{0,40}\b(on|in|into|to)\s+(the\s+)?(site|page|website|app)\b/i.test(
        t
      )
    ) {
      return 'embed_asset';
    }
    if (/\b(reference|like this|recreate|replicate|clone|mockup|layout|dashboard ui)\b/i.test(t)) {
      return 'design_reference';
    }
    return 'infer_from_prompt';
  }

  return 'infer_from_prompt';
}

/**
 * Build permanent excloud public URLs for every attachment (always from storageKey).
 */
export function resolveReferenceImagesForSandbox(
  images: ReferenceImageInput[]
): { resolved: ResolvedReferenceImage[]; failed: string[] } {
  const resolved: ResolvedReferenceImage[] = [];
  const failed: string[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const storageKey = img.storageKey?.trim();
    if (!storageKey) {
      failed.push(img.fileName || `image-${i + 1}`);
      continue;
    }

    try {
      resolved.push({
        fileName: img.fileName,
        publicUrl: buildAttachmentPublicUrl(storageKey),
      });
    } catch (error) {
      console.error(
        '[reference-images] public URL failed:',
        img.fileName,
        error instanceof Error ? error.message : error
      );
      failed.push(img.fileName || `image-${i + 1}`);
    }
  }

  return { resolved, failed };
}

export function referenceImagePublicUrls(
  resolved: ResolvedReferenceImage[]
): string[] {
  return resolved.map((r) => r.publicUrl);
}

function rulesForIntent(intent: ReferenceImageIntent): string[] {
  switch (intent) {
    case 'embed_asset':
      return [
        'INTENT: EMBED ATTACHED IMAGE(S) — the user wants this file displayed on the site (logo, hero, banner, photo, avatar, product image, etc.).',
        'Use the exact public URL from this list in JSX, e.g. <img src="https://1015.objects.excloud.dev/..." alt="..." className="..." /> or next/image when appropriate.',
        'Place the image inside the page layout where the user asked (header, hero, card, gallery, etc.) — not as a lazy full-page screenshot unless they asked for a full-screen image viewer.',
        'You may still build surrounding UI with React + Tailwind; the attachment URL is real content to show.',
      ];
    case 'design_reference':
      return [
        'INTENT: DESIGN REFERENCE — the user wants you to BUILD UI in React + Tailwind + Shadcn that matches the attached mockup/screenshot.',
        'Recreate layout structure: nav/sidebar, header, cards, tables, charts, spacing, colors, typography, and section hierarchy.',
        'Do NOT build a page that only shows the uploaded screenshot as a full-width or full-screen <img> — implement the interface in code.',
        'Do NOT use the attachment URL as a substitute for building the UI. Use mock data and real components.',
        'Only use the attachment URL inside <img> if a small part of the design is meant to be that exact asset (rare for mockups).',
      ];
    default:
      return [
        'INTENT: READ THE USER MESSAGE — they attached image(s) but did not state intent clearly. Choose ONE approach:',
        'A) EMBED: If they want the file ON the website (add/show/use/put this image, logo, hero, banner, photo on the page) → use the exact URL in <img src="..."> where it belongs.',
        'B) DESIGN REFERENCE: If they want UI LIKE the image (like this, this type of dashboard, recreate, use as reference to build) → rebuild the interface in React + Tailwind; do NOT show only the screenshot full-screen.',
        'When unsure, prefer design reference for full-page dashboard/app screenshots and embed for logos/photos/product shots.',
      ];
  }
}

export function formatReferenceImagesPromptSection(
  resolved: ResolvedReferenceImage[],
  failedNames: string[],
  userPrompt = ''
): string {
  if (resolved.length === 0 && failedNames.length === 0) return '';

  const lines: string[] = [];

  for (const img of resolved) {
    lines.push(`- ${img.fileName} → ${img.publicUrl}`);
  }

  for (const name of failedNames) {
    lines.push(`- ${name} → upload failed; use a placeholder — never base64`);
  }

  const intent = classifyReferenceImageIntent(userPrompt);
  const intentRules = rulesForIntent(intent);

  return [
    '<reference_images>',
    `Detected intent: ${intent.replace(/_/g, ' ')} (re-read the user message if this seems wrong).`,
    ...intentRules,
    'Technical rules for attachment URLs:',
    '- Copy the full https URL from this list exactly when an asset belongs in the UI.',
    '- Never use localhost, /refs/, relative paths, base64, or writeProjectFile for image binaries.',
    'URL shape: https://1015.objects.excloud.dev/public/vibe/users/{userId}/projects/{projectId}/{attachmentId}.png',
    ...lines,
    '</reference_images>',
  ].join('\n');
}
