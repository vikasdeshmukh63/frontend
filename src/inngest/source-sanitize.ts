import ts from 'typescript';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const CLIPBOARD_WRITE_RE =
  /(?:await\s+)?navigator\.clipboard\.writeText\s*\(\s*([^);]+)\s*\)/g;

function isSourcePath(path: string): boolean {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return false;
  return SOURCE_EXTENSIONS.has(lower.slice(dot));
}

/** Strip markdown fences and obvious wrapper junk. */
export function sanitizeGeneratedSourceContent(content: string): string {
  let c = content;
  if (c.charCodeAt(0) === 0xfeff) {
    c = c.slice(1);
  }
  c = c.trim();

  const fenced = c.match(
    /^```(?:tsx?|jsx?|typescript|javascript)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i
  );
  if (fenced) {
    c = fenced[1]!.trim();
  }

  // Inline fence at start (model pasted opening fence only)
  if (c.startsWith('```')) {
    const lines = c.split(/\r?\n/);
    if (lines[0]?.startsWith('```')) {
      lines.shift();
      if (lines.at(-1)?.trim() === '```') lines.pop();
      c = lines.join('\n').trim();
    }
  }

  return c;
}

export function rewriteClipboardApi(content: string): string {
  if (!/\bnavigator\.clipboard\b/.test(content)) {
    return content;
  }

  let c = content.replace(
    CLIPBOARD_WRITE_RE,
    (_match, arg: string) => `copyTextSafe(${arg.trim()})`
  );

  const hasImport =
    /from\s+['"]@\/lib\/safe-copy['"]/.test(c) ||
    /from\s+['"]@\/lib\/safe-copy['"]/.test(c);

  if (!hasImport) {
    const importLine = `import { copyTextSafe } from "@/lib/safe-copy";\n`;
    if (/^['"]use client['"]\s*;?/m.test(c)) {
      c = c.replace(
        /^(['"]use client['"]\s*;?\s*\n)/,
        `$1${importLine}`
      );
    } else {
      c = `'use client';\n\n${importLine}${c}`;
    }
  }

  return c;
}

export function getSourceParseDiagnostics(
  fileName: string,
  content: string
): string[] {
  const lower = fileName.toLowerCase();
  const scriptKind = lower.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : lower.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : lower.endsWith('.js')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );

  return sourceFile.parseDiagnostics.map((d) => {
    const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    const pos = d.start ?? 0;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
    return `Line ${line + 1}:${character + 1}: ${message}`;
  });
}

export function validateSourceSyntax(
  path: string,
  content: string
): { ok: true } | { ok: false; errors: string[] } {
  if (!isSourcePath(path)) {
    return { ok: true };
  }

  const diagnostics = getSourceParseDiagnostics(path, content);
  if (diagnostics.length === 0) {
    return { ok: true };
  }

  return { ok: false, errors: diagnostics.slice(0, 5) };
}

/**
 * Iteratively fix common agent syntax mistakes until the TS parser accepts the file
 * or we run out of safe transforms.
 */
export function repairSourceContent(path: string, content: string): string {
  if (!isSourcePath(path)) {
    return content;
  }

  let c = rewriteClipboardApi(sanitizeGeneratedSourceContent(content));

  for (let attempt = 0; attempt < 16; attempt++) {
    const diagnostics = getSourceParseDiagnostics(path, c);
    if (diagnostics.length === 0) {
      break;
    }

    const msg = diagnostics.join(' ').toLowerCase();
    const trimmed = c.trimEnd();
    let next = trimmed;
    let changed = false;

    // Exact user-reported bug: closing brace + stray double-quote at EOF (}")
    if (/}\s*"$/.test(trimmed) || msg.includes('unterminated string')) {
      if (/}\s*"$/.test(trimmed)) {
        next = trimmed.replace(/"\s*$/, '');
        changed = true;
      } else if (/}\s*'$/.test(trimmed)) {
        next = trimmed.replace(/'\s*$/, '');
        changed = true;
      }
    }

    if (trimmed.endsWith('```')) {
      next = trimmed.slice(0, -3).trimEnd();
      changed = true;
    }

    // Trailing lone quote on its own line after a closing brace
    const lines = next.split('\n');
    const last = lines.at(-1)?.trim() ?? '';
    if (last === '"' || last === "'" || last === '";' || last === "';") {
      lines.pop();
      next = lines.join('\n').trimEnd();
      changed = true;
    }

    // Stray opening quote before export/default at file start
    if (next.startsWith('"') && /^(export|import|['"]use client)/m.test(next.slice(1))) {
      next = next.replace(/^["']+/, '');
      changed = true;
    }

    if (!changed || next === c) {
      break;
    }
    c = next;
  }

  return c;
}

/**
 * Full pipeline for any file written to the sandbox — always run this before disk write.
 */
export function prepareSandboxSourceForWrite(
  path: string,
  content: string
): string {
  if (!isSourcePath(path)) {
    return content;
  }
  return repairSourceContent(path, content);
}

export function sanitizeAndValidateSource(
  path: string,
  content: string
): { ok: true; content: string } | { ok: false; error: string } {
  if (!isSourcePath(path)) {
    return { ok: true, content };
  }

  const prepared = repairSourceContent(path, content);
  const syntax = validateSourceSyntax(path, prepared);
  if (!syntax.ok) {
    const detail = syntax.errors.join(' ');
    return {
      ok: false,
      error: `File "${path}" has invalid TypeScript/TSX syntax (${detail}). Fix unterminated strings, stray quotes after "}", and unescaped characters. Output only valid source — no markdown fences or trailing garbage.`,
    };
  }

  return { ok: true, content: prepared };
}

/** Repair agent-written sources before persisting fragments. */
export function sanitizeFileMap(
  files: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    out[path] = isSourcePath(path)
      ? prepareSandboxSourceForWrite(path, content)
      : content;
  }
  return out;
}

/** Re-read all sandbox sources, repair, and write back (post-agent safety net). */
export async function repairAllSandboxSourceFiles(
  sandboxId: string
): Promise<{ repaired: number }> {
  const { snapshotSandboxProjectFiles, writeSandboxProjectFiles } =
    await import('@/inngest/project-sandbox');
  const { ensureUseClientDirective } = await import(
    '@/inngest/project-file-validation'
  );

  const files = await snapshotSandboxProjectFiles(sandboxId);
  const updates: { path: string; content: string }[] = [];

  for (const [path, content] of Object.entries(files)) {
    if (!isSourcePath(path)) continue;

    const beforeDiag = getSourceParseDiagnostics(path, content);
    const prepared = ensureUseClientDirective(
      path,
      prepareSandboxSourceForWrite(path, content)
    );
    const afterDiag = getSourceParseDiagnostics(path, prepared);

    if (afterDiag.length === 0 && (prepared !== content || beforeDiag.length > 0)) {
      updates.push({ path, content: prepared });
    }
  }

  if (updates.length > 0) {
    await writeSandboxProjectFiles(sandboxId, updates, { skipPrepare: true });
  }

  return { repaired: updates.length };
}
