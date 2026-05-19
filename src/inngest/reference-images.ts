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

export function formatReferenceImagesPromptSection(
  resolved: ResolvedReferenceImage[],
  failedNames: string[]
): string {
  if (resolved.length === 0 && failedNames.length === 0) return '';

  const lines: string[] = [];

  for (const img of resolved) {
    lines.push(`- ${img.fileName} → ${img.publicUrl}`);
  }

  for (const name of failedNames) {
    lines.push(`- ${name} → upload failed; use a placeholder — never base64`);
  }

  return [
    '<reference_images>',
    'Each user image has a permanent public URL on excloud. Copy the URL below EXACTLY into the sandbox app.',
    'URL shape: https://1015.objects.excloud.dev/public/vibe/users/{userId}/projects/{projectId}/{attachmentId}.png',
    'Example in JSX:',
    '  <img src="https://1015.objects.excloud.dev/public/vibe/users/.../projects/.../....png" alt="Logo" className="h-8 w-auto" />',
    'Rules: use the full https URL from this list only; plain <img> tag; no localhost, no /refs/, no base64, no writeProjectFile for images.',
    ...lines,
    '</reference_images>',
  ].join('\n');
}
