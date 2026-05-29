import {
  isAppLayoutPath,
  isProtectedSandboxPath,
  isRootLayoutPath,
  isValidRootLayoutContent,
  pageHasIllegalDocumentShell,
} from '@/inngest/sandbox-bootstrap';
import {
  prepareSandboxSourceForWrite,
  validateSourceSyntax,
} from '@/inngest/source-sanitize';

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

const REACT_IMPORT_RE = /\bfrom\s+["']react["']/;

const NEXT_NAV_IMPORT_RE = /\bfrom\s+["']next\/navigation["']/;

/** Hooks / patterns that require a Client Component in the App Router. */
const CLIENT_SYNTAX_RE = new RegExp(
  [
    '\\buse(State|Effect|Memo|Callback|Reducer|Ref|LayoutEffect|ImperativeHandle|Context|Transition|DeferredValue|SyncExternalStore|Id)\\b',
    '\\buse(Params|SearchParams|Router|Pathname|SelectedLayoutSegment)\\b',
    '\\bon(Click|Change|Submit|KeyDown|KeyUp|MouseDown|MouseUp|Input|Focus|Blur|Drag|Drop|PointerDown|PointerUp|Scroll|Wheel)=',
  ].join('|'),
  'i'
);

function contentImpliesClientComponent(content: string): boolean {
  if (!CLIENT_SYNTAX_RE.test(content)) return false;
  if (REACT_IMPORT_RE.test(content)) return true;
  if (NEXT_NAV_IMPORT_RE.test(content)) return true;
  return false;
}

function isAppRouterSourcePath(rel: string): boolean {
  const n = rel.replace(/\\/g, '/').toLowerCase();
  return n.startsWith('app/') || n.startsWith('src/app/');
}

function firstNonEmptyLine(content: string): string | undefined {
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return undefined;
}

export function hasUseClientDirective(content: string): boolean {
  const first = firstNonEmptyLine(content);
  if (!first) return false;
  return /^["']use client["']\s*;?\s*$/.test(first);
}

/**
 * If the model wrote client-only code without `"use client"`, prepend it so
 * Next.js 15 does not fail the build (Server Component + hooks error).
 */
export function ensureUseClientDirective(rel: string, content: string): string {
  const lower = rel.replace(/\\/g, '/').toLowerCase();
  if (!lower.endsWith('.tsx') && !lower.endsWith('.jsx')) return content;
  if (!isAppRouterSourcePath(lower)) return content;
  if (hasUseClientDirective(content)) return content;
  if (!contentImpliesClientComponent(content)) {
    return content;
  }
  return `'use client';\n\n${content}`;
}

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

/** Catch SelectItem outside SelectContent — common agent mistake that crashes at runtime. */
function validateShadcnSelectUsage(content: string): ProjectFileValidationResult {
  if (!content.includes('SelectItem')) {
    return { ok: true };
  }

  if (!content.includes('SelectContent')) {
    return {
      ok: false,
      error:
        'SelectItem must be used inside SelectContent. Structure: <Select><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="x">Label</SelectItem></SelectContent></Select>. Never put SelectItem beside the trigger or in a table without SelectContent.',
    };
  }

  const firstContent = content.indexOf('SelectContent');
  const firstItem = content.indexOf('SelectItem');
  if (firstItem !== -1 && firstContent !== -1 && firstItem < firstContent) {
    return {
      ok: false,
      error:
        'SelectItem appears before SelectContent. Move every SelectItem inside <SelectContent>...</SelectContent>.',
    };
  }

  return { ok: true };
}

function validateShadcnDropdownMenuUsage(
  content: string
): ProjectFileValidationResult {
  if (!content.includes('DropdownMenuItem')) {
    return { ok: true };
  }

  if (!content.includes('DropdownMenuContent')) {
    return {
      ok: false,
      error:
        'DropdownMenuItem must be inside DropdownMenuContent (DropdownMenu > DropdownMenuTrigger + DropdownMenuContent > items).',
    };
  }

  return { ok: true };
}

export function validateProjectFileWrite(
  path: string,
  content: string
): ProjectFileValidationResult {
  const rel = path.trim().replace(/\\/g, '/');
  const lower = rel.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : '';
  /** Validate the repaired form that will actually be written to disk. */
  const prepared = prepareSandboxSourceForWrite(rel, content);

  if (rel.startsWith('public/refs/') || rel.startsWith('refs/')) {
    return {
      ok: false,
      error: `Cannot write "${rel}" — use the full HTTPS URL from <reference_images> in <img src="..."> instead of writing image files.`,
    };
  }

  if (isProtectedSandboxPath(rel)) {
    return {
      ok: false,
      error: `Cannot modify "${rel}" — it is managed by the sandbox template. Edit app/page.tsx and components/ only. Never write app/layout.tsx or app/globals.css.`,
    };
  }

  if (isAppLayoutPath(rel)) {
    return {
      ok: false,
      error: `Cannot modify "${rel}" — App Router layout files are fixed. Change page/components only; do not alter layout shells.`,
    };
  }

  if (isRootLayoutPath(rel) && !isValidRootLayoutContent(prepared)) {
    return {
      ok: false,
      error: `Root layout must include <html> and <body> tags. Do not create or edit app/layout.tsx — the template already provides it.`,
    };
  }

  if (
    (lower.endsWith('/page.tsx') || lower === 'app/page.tsx' || lower === 'src/app/page.tsx') &&
    pageHasIllegalDocumentShell(prepared)
  ) {
    return {
      ok: false,
      error: `Do not put <html> or <body> in page.tsx. Return only page content; the root layout wraps your UI.`,
    };
  }

  if (BINARY_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error: `Cannot write binary "${rel}" via writeProjectFile. For user uploads use the HTTPS URL from <reference_images>. Otherwise use "/mock/..." paths — never embed base64.`,
    };
  }

  const bytes = byteLength(prepared);
  if (bytes > MAX_PROJECT_FILE_WRITE_BYTES) {
    return {
      ok: false,
      error: `File "${rel}" is ${bytes} bytes (max ${MAX_PROJECT_FILE_WRITE_BYTES}). Split into smaller .tsx modules. Never put image/binary data in source files.`,
    };
  }

  if (looksLikeEmbeddedImage(prepared)) {
    return {
      ok: false,
      error: `File "${rel}" looks like base64 image data, not source code. Use paths like "/mock/listing-1.jpg" in mock data, or colored div placeholders — do not embed images in TS/TSX.`,
    };
  }

  if (rel.endsWith('.tsx') || rel.endsWith('.jsx')) {
    const selectCheck = validateShadcnSelectUsage(prepared);
    if (!selectCheck.ok) return selectCheck;

    const menuCheck = validateShadcnDropdownMenuUsage(prepared);
    if (!menuCheck.ok) return menuCheck;
  }

  if (
    rel.endsWith('.ts') ||
    rel.endsWith('.tsx') ||
    rel.endsWith('.js') ||
    rel.endsWith('.jsx')
  ) {
    const syntax = validateSourceSyntax(rel, prepared);
    if (!syntax.ok) {
      return {
        ok: false,
        error: `File "${rel}" has invalid syntax: ${syntax.errors.join(' ')}. Ensure the file is complete valid TSX — no markdown fences, no extra quote after the closing "}", and all strings properly closed.`,
      };
    }
  }

  return { ok: true };
}
