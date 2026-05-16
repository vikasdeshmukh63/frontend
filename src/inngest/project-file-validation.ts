import {
  isProtectedSandboxPath,
  isRootLayoutPath,
  isValidRootLayoutContent,
  pageHasIllegalDocumentShell,
} from '@/inngest/sandbox-bootstrap';

/** Max UTF-8 bytes per writeProjectFile / createOrUpdateFiles payload (keeps tool JSON under model limits). */
export const MAX_PROJECT_FILE_WRITE_BYTES = 48_000;

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.avif',
]);

export type ProjectFileValidationResult =
  | { ok: true }
  | { ok: false; error: string };

function byteLength(content: string): number {
  return Buffer.byteLength(content, 'utf8');
}

function looksLikeEmbeddedImage(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;

  if (/^iVBORw0KGgo/i.test(trimmed)) return true;
  if (/^\/9j\//.test(trimmed)) return true;
  if (/^R0lGOD/i.test(trimmed)) return true;
  if (/^data:image\/[a-z+]+;base64,/i.test(trimmed)) return true;

  const sample = trimmed.slice(0, 4096);
  if (
    sample.length > 500 &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(sample) &&
    !sample.includes('import ') &&
    !sample.includes('export ') &&
    !sample.includes('function ') &&
    !sample.includes('const ')
  ) {
    return true;
  }

  return false;
}

export function validateProjectFileWrite(
  path: string,
  content: string
): ProjectFileValidationResult {
  const rel = path.trim().replace(/\\/g, '/');
  const lower = rel.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : '';

  if (isProtectedSandboxPath(rel)) {
    return {
      ok: false,
      error: `Cannot modify "${rel}" — it is managed by the sandbox template. Edit app/page.tsx and components/ only. Never write app/layout.tsx or app/globals.css.`,
    };
  }

  if (isRootLayoutPath(rel) && !isValidRootLayoutContent(content)) {
    return {
      ok: false,
      error: `Root layout must include <html> and <body> tags. Do not create or edit app/layout.tsx — the template already provides it.`,
    };
  }

  if (
    (lower.endsWith('/page.tsx') || lower === 'app/page.tsx' || lower === 'src/app/page.tsx') &&
    pageHasIllegalDocumentShell(content)
  ) {
    return {
      ok: false,
      error: `Do not put <html> or <body> in page.tsx. Return only page content; the root layout wraps your UI.`,
    };
  }

  if (BINARY_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error: `Cannot write binary "${rel}" via writeProjectFile. Reference images as "/mock/..." paths or use Tailwind/CSS placeholders — never embed base64 in the repo.`,
    };
  }

  const bytes = byteLength(content);
  if (bytes > MAX_PROJECT_FILE_WRITE_BYTES) {
    return {
      ok: false,
      error: `File "${rel}" is ${bytes} bytes (max ${MAX_PROJECT_FILE_WRITE_BYTES}). Split into smaller .tsx modules. Never put image/binary data in source files.`,
    };
  }

  if (looksLikeEmbeddedImage(content)) {
    return {
      ok: false,
      error: `File "${rel}" looks like base64 image data, not source code. Use paths like "/mock/listing-1.jpg" in mock data, or colored div placeholders — do not embed images in TS/TSX.`,
    };
  }

  return { ok: true };
}
