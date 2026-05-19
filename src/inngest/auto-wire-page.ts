import {
  normalizeSandboxRelativePath,
  snapshotSandboxProjectFiles,
  toSandboxAbsolutePath,
  writeSandboxProjectFiles,
} from '@/inngest/project-sandbox';
import { getSandbox } from '@/inngest/utils';
import { isDefaultNextStarterPage } from '@/inngest/generation-guard';

const PAGE_PATHS = ['app/page.tsx', 'src/app/page.tsx'] as const;

const SOURCE_PATH_RE =
  /^(app\/|src\/app\/|components\/|src\/components\/)/;

function resolvePagePath(files: Record<string, string>): string {
  if (
    'src/app/page.tsx' in files ||
    Object.keys(files).some((k) => k.startsWith('src/app/'))
  ) {
    return 'src/app/page.tsx';
  }
  return 'app/page.tsx';
}

function isUiPrimitivePath(path: string): boolean {
  return path.includes('/components/ui/');
}

function isSourceFile(path: string): boolean {
  return (
    (path.endsWith('.tsx') || path.endsWith('.ts')) &&
    !path.endsWith('page.tsx') &&
    !path.includes('layout.tsx') &&
    !path.includes('graphify-out') &&
    !isUiPrimitivePath(path) &&
    SOURCE_PATH_RE.test(path)
  );
}

function extractDefaultExportName(content: string): string | null {
  const fn = content.match(/export\s+default\s+function\s+(\w+)/);
  if (fn?.[1]) return fn[1];
  const ident = content.match(/export\s+default\s+(\w+)\s*;/);
  if (ident?.[1] && ident[1] !== 'function') return ident[1];
  return null;
}

/** Shadcn components often use named exports only. */
function extractComponentName(
  content: string,
  filePath: string
): { name: string; defaultImport: boolean } {
  const def = extractDefaultExportName(content);
  if (def) return { name: def, defaultImport: true };

  const namedFn = content.match(
    /export\s+(?:async\s+)?function\s+(\w+)/
  );
  if (namedFn?.[1]) return { name: namedFn[1], defaultImport: false };

  const namedConst = content.match(/export\s+const\s+(\w+)\s*=/);
  if (namedConst?.[1]) return { name: namedConst[1], defaultImport: false };

  const base =
    filePath
      .split('/')
      .pop()
      ?.replace(/\.tsx$/, '') ?? 'AppSection';
  return { name: base, defaultImport: false };
}

function importPathFromPage(pagePath: string, componentPath: string): string {
  const pageDir = pagePath.replace(/\/[^/]+$/, '');
  const compBase = componentPath.replace(/\.(tsx|ts)$/, '');
  if (compBase.startsWith(`${pageDir}/`)) {
    return `.${compBase.slice(pageDir.length)}`;
  }
  return `@/${compBase}`;
}

function importLine(
  pagePath: string,
  componentPath: string,
  content: string
): string {
  const { name, defaultImport } = extractComponentName(content, componentPath);
  const path = importPathFromPage(pagePath, componentPath);
  return defaultImport
    ? `import ${name} from "${path}";`
    : `import { ${name} } from "${path}";`;
}

function componentTag(content: string, filePath: string): string {
  return extractComponentName(content, filePath).name;
}

function findNamedExport(content: string, pattern: RegExp): string | null {
  const m = content.match(pattern);
  return m?.[1] ?? null;
}

function findMockDataFile(
  files: Record<string, string>
): { path: string; exportName: string } | null {
  for (const [path, content] of Object.entries(files)) {
    if (!isSourceFile(path) && !path.endsWith('.ts')) continue;
    if (!/mock|data|fixtures|listings|items|products|users/i.test(path)) {
      continue;
    }
    const exportName =
      findNamedExport(content, /export\s+const\s+(\w+)\s*=/) ??
      findNamedExport(content, /export\s+const\s+(\w+)\s*:\s*\[/) ??
      findNamedExport(content, /export\s+const\s+(\w+)\s*=\s*\[/);
    if (exportName) return { path, exportName };
  }
  return null;
}

function findCardComponent(
  files: Record<string, string>
): { path: string; content: string } | null {
  const candidates = Object.entries(files).filter(
    ([p]) => p.endsWith('.tsx') && isSourceFile(p) && /Card|Item|Tile|Listing|Row|Product/i.test(p)
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b[1].length - a[1].length);
  const [path, content] = candidates[0];
  return { path, content };
}

function pickScreenComponent(
  files: Record<string, string>
): { path: string; content: string } | null {
  const entries = Object.entries(files).filter(
    ([p]) => p.endsWith('.tsx') && isSourceFile(p)
  );

  const screenName = entries.find(([p]) =>
    /(Page|Dashboard|Home|Screen|View|App|Feed|Layout|Shell)\.tsx$/i.test(p)
  );
  if (screenName) return { path: screenName[0], content: screenName[1] };

  const underApp = entries.filter(([p]) => p.includes('/_components/'));
  if (underApp.length === 1) {
    return { path: underApp[0][0], content: underApp[0][1] };
  }
  if (underApp.length > 1) {
    const cardLike = underApp.find(([p]) => /Card|Dashboard|Main|Hero/i.test(p));
    if (cardLike) return { path: cardLike[0], content: cardLike[1] };
    underApp.sort((a, b) => b[1].length - a[1].length);
    return { path: underApp[0][0], content: underApp[0][1] };
  }

  const underComponents = entries.filter(([p]) => p.startsWith('components/'));
  if (underComponents.length >= 1) {
    underComponents.sort((a, b) => b[1].length - a[1].length);
    return { path: underComponents[0][0], content: underComponents[0][1] };
  }

  return null;
}

export function hasCustomSourceFiles(files: Record<string, string>): boolean {
  return Object.keys(files).some((p) => isSourceFile(p));
}

export function buildAutoWiredAppPage(files: Record<string, string>): {
  pagePath: string;
  content: string;
} | null {
  const pagePath = resolvePagePath(files);
  const existing = files[pagePath]?.trim();
  if (existing && !isDefaultNextStarterPage(existing)) {
    return null;
  }

  const mock = findMockDataFile(files);
  const card = findCardComponent(files);

  if (mock && card) {
    const cardImp = importLine(pagePath, card.path, card.content);
    const mockImp = importPathFromPage(pagePath, mock.path);
    const tag = componentTag(card.content, card.path);
    return {
      pagePath,
      content: [
        '"use client";',
        '',
        cardImp,
        `import { ${mock.exportName} } from "${mockImp}";`,
        '',
        'export default function Page() {',
        '  return (',
        '    <main className="min-h-screen bg-background p-6">',
        '      <div className="mx-auto max-w-6xl">',
        '        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Overview</h1>',
        '        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">',
        `          {${mock.exportName}.map((item, index) => (`,
        `            <${tag} key={String((item as { id?: string }).id ?? index)} {...(item as object)} />`,
        '          ))}',
        '        </div>',
        '      </div>',
        '    </main>',
        '  );',
        '}',
      ].join('\n'),
    };
  }

  const screen = pickScreenComponent(files);
  if (screen) {
    const imp = importLine(pagePath, screen.path, screen.content);
    const tag = componentTag(screen.content, screen.path);
    return {
      pagePath,
      content: [
        '"use client";',
        '',
        imp,
        '',
        'export default function Page() {',
        '  return (',
        '    <main className="min-h-screen bg-background">',
        `      <${tag} />`,
        '    </main>',
        '  );',
        '}',
      ].join('\n'),
    };
  }

  return null;
}

export function buildFallbackAppPage(userPrompt: string): {
  pagePath: string;
  content: string;
} {
  const safe = userPrompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 200);
  return {
    pagePath: 'app/page.tsx',
    content: `"use client";

export default function Page() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Your application</h1>
      <p className="text-muted-foreground max-w-lg text-center text-sm">
        ${safe || 'Send another message to refine this screen.'}
      </p>
    </main>
  );
}
`,
  };
}

export async function mergeAgentAndSandboxFiles(
  sandboxId: string,
  agentFiles: Record<string, string>
): Promise<Record<string, string>> {
  const snapshot = await snapshotSandboxProjectFiles(sandboxId);
  const merged = { ...snapshot, ...agentFiles };

  try {
    const sandbox = await getSandbox(sandboxId);
    for (const rel of PAGE_PATHS) {
      try {
        const raw = await sandbox.files.read(toSandboxAbsolutePath(rel));
        const content = typeof raw === 'string' ? raw : String(raw);
        merged[normalizeSandboxRelativePath(rel)] = content;
      } catch {
        /* missing */
      }
    }
  } catch {
    /* sandbox read failed */
  }

  return merged;
}

export async function tryAutoWireAppPage(
  sandboxId: string,
  files: Record<string, string>
): Promise<{ pagePath: string; content: string } | null> {
  const built = buildAutoWiredAppPage(files);
  if (!built) return null;

  await writeSandboxProjectFiles(sandboxId, [
    { path: built.pagePath, content: built.content },
  ]);

  return built;
}

/**
 * Guarantees a non-starter app/page.tsx for preview when the agent wrote components
 * but skipped the route entry.
 */
export async function ensureAppPageForPreview(params: {
  sandboxId: string;
  userPrompt: string;
}): Promise<
  | {
      ok: true;
      pagePath: string;
      source: 'existing' | 'auto-wire' | 'fallback';
    }
  | { ok: false }
> {
  const merged = await mergeAgentAndSandboxFiles(params.sandboxId, {});
  const pagePath = resolvePagePath(merged);
  const existing = merged[pagePath]?.trim();

  if (existing && !isDefaultNextStarterPage(existing)) {
    return { ok: true, pagePath, source: 'existing' };
  }

  const wired = buildAutoWiredAppPage(merged);
  if (wired) {
    await writeSandboxProjectFiles(params.sandboxId, [
      { path: wired.pagePath, content: wired.content },
    ]);
    return { ok: true, pagePath: wired.pagePath, source: 'auto-wire' };
  }

  if (hasCustomSourceFiles(merged)) {
    const fallback = buildFallbackAppPage(params.userPrompt);
    await writeSandboxProjectFiles(params.sandboxId, [
      { path: fallback.pagePath, content: fallback.content },
    ]);
    return { ok: true, pagePath: fallback.pagePath, source: 'fallback' };
  }

  return { ok: false };
}

export function hasValidAppPage(files: Record<string, string>): boolean {
  for (const path of PAGE_PATHS) {
    const content = files[path]?.trim();
    if (content && !isDefaultNextStarterPage(content)) {
      return true;
    }
  }
  return false;
}
