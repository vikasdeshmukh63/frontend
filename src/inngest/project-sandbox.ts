import { Sandbox } from '@e2b/code-interpreter';

import { prisma } from '@/lib/db';
import { SANDBOX_TIMEOUT } from '@/inngest/types';
import { runSandboxCommand } from '@/inngest/timeouts';
import {
  ensureSandboxBootstrapFiles,
  stripProtectedPathsFromFileMap,
} from '@/inngest/sandbox-bootstrap';
import { prepareSandboxSourceForWrite } from '@/inngest/source-sanitize';
import { ensureUseClientDirective } from '@/inngest/project-file-validation';

/** E2B template for the Next.js dev sandbox (unchanged from original flow). */
const E2B_TEMPLATE_ID = 'vikasdeshmukh63/vibe-nextjs-test1';

/** Next.js app root inside the E2B sandbox (matches template Dockerfile). */
export const SANDBOX_PROJECT_ROOT = '/home/user';

const GRAPHIFY_DIR = 'graphify-out';
const GRAPH_JSON_PATH = `${GRAPHIFY_DIR}/graph.json`;
const GRAPH_REPORT_PATH = `${GRAPHIFY_DIR}/GRAPH_REPORT.md`;
const GRAPH_CONTEXT_PATH = `${GRAPHIFY_DIR}/graph-lite-context.md`;
const GRAPH_SELECTED_PATH = `${GRAPHIFY_DIR}/selected-files.json`;

function fragmentFilesToRecord(files: unknown): Record<string, string> {
  if (!files || typeof files !== 'object' || Array.isArray(files)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(files as Record<string, unknown>)) {
    if (typeof v === 'string') out[normalizeSandboxRelativePath(k)] = v;
  }
  return out;
}

/** Strip sandbox root / leading slashes so DB + UI use paths like `app/page.tsx`. */
export function normalizeSandboxRelativePath(path: string): string {
  let p = path.trim().replace(/\\/g, '/');
  if (p.startsWith(SANDBOX_PROJECT_ROOT)) {
    p = p.slice(SANDBOX_PROJECT_ROOT.length);
  }
  return p.replace(/^\/+/, '');
}

/** E2B `files.write` requires absolute paths under the project root. */
export function toSandboxAbsolutePath(path: string): string {
  const rel = normalizeSandboxRelativePath(path);
  return rel ? `${SANDBOX_PROJECT_ROOT}/${rel}` : SANDBOX_PROJECT_ROOT;
}

/** Write binary assets (e.g. user reference photos) into the sandbox. */
export async function writeSandboxBinaryFile(
  sandboxId: string,
  relativePath: string,
  data: Buffer | Uint8Array
): Promise<void> {
  const sandbox = await Sandbox.connect(sandboxId);
  await sandbox.setTimeout(SANDBOX_TIMEOUT);
  const bytes = Uint8Array.from(data);
  await sandbox.files.write(
    toSandboxAbsolutePath(relativePath),
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  );
}

export async function writeSandboxProjectFiles(
  sandboxId: string,
  files: Array<{ path: string; content: string }>,
  options?: { skipPrepare?: boolean }
): Promise<void> {
  if (files.length === 0) return;

  const sandbox = await Sandbox.connect(sandboxId);
  await sandbox.setTimeout(SANDBOX_TIMEOUT);

  for (const file of files) {
    const rel = normalizeSandboxRelativePath(file.path);
    const content = options?.skipPrepare
      ? file.content
      : ensureUseClientDirective(
          rel,
          prepareSandboxSourceForWrite(rel, file.content)
        );

    await sandbox.files.write(toSandboxAbsolutePath(rel), content);
  }
}

/** Start Next dev server if port 3000 is not responding (template process may have died). */
export async function ensureSandboxDevServerRunning(
  sandboxId: string
): Promise<void> {
  const sandbox = await Sandbox.connect(sandboxId);
  await sandbox.setTimeout(SANDBOX_TIMEOUT);

  const probe = await runSandboxCommand(
    sandbox,
    'curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://127.0.0.1:3000/ 2>/dev/null || echo 000',
    { timeoutMs: 15_000 }
  );
  const code = probe.stdout.trim().slice(-3);
  if (code === '200' || code === '304') return;

  /** Never throw: npm/curl may exit non-zero while the dev server still comes up (E2B CommandExitError). */
  try {
    await runSandboxCommand(
      sandbox,
      [
        'set +e',
        `cd "${SANDBOX_PROJECT_ROOT}" || true`,
        'pkill -f "next dev" 2>/dev/null || true',
        '(nohup npm run dev -- -p 3000 -H 0.0.0.0 > /tmp/next-dev.log 2>&1 &)',
        'sleep 2',
        'exit 0',
      ].join('; '),
      { timeoutMs: 45_000 }
    );
    const { ready, httpCode } = await waitForSandboxPreviewReady(sandboxId, 90_000);
    if (!ready) {
      const log = await runSandboxCommand(
        sandbox,
        'tail -n 30 /tmp/next-dev.log 2>/dev/null || echo "(no dev log)"',
        { timeoutMs: 10_000 }
      );
      console.warn(
        `[sandbox] dev server not ready after start (HTTP ${httpCode}):`,
        log.stdout.slice(-1500)
      );
    }
  } catch (e) {
    console.warn(
      '[sandbox] ensureSandboxDevServerRunning: start command failed (ignored)',
      e
    );
  }
}

/** Nudge the running dev server after bulk writes (best-effort). Never throws. */
export async function refreshSandboxDevServer(sandboxId: string): Promise<void> {
  try {
    await ensureSandboxDevServerRunning(sandboxId);
  } catch (e) {
    console.warn(
      '[sandbox] refreshSandboxDevServer: ensureSandboxDevServerRunning failed (ignored)',
      e
    );
  }
  try {
    const sandbox = await Sandbox.connect(sandboxId);
    await sandbox.setTimeout(SANDBOX_TIMEOUT);
    try {
      await runSandboxCommand(
        sandbox,
        [
          `touch ${SANDBOX_PROJECT_ROOT}/app/page.tsx 2>/dev/null || true`,
          `touch ${SANDBOX_PROJECT_ROOT}/src/app/page.tsx 2>/dev/null || true`,
          'curl -s --max-time 20 -o /dev/null http://127.0.0.1:3000/ || true',
          'sleep 2',
          'curl -s --max-time 20 -o /dev/null http://127.0.0.1:3000/ || true',
        ].join('; '),
        { timeoutMs: 60_000 }
      );
    } catch {
      // Preview may still hot-reload; do not fail the run.
    }
  } catch (e) {
    console.warn(
      '[sandbox] refreshSandboxDevServer: connect or nudge failed (ignored)',
      e
    );
  }
}

/**
 * Poll until Next returns HTML with a real app shell (avoids blank iframe while compiling).
 */
export async function waitForSandboxPreviewReady(
  sandboxId: string,
  maxWaitMs = 120_000
): Promise<{ ready: boolean; httpCode: string }> {
  const sandbox = await Sandbox.connect(sandboxId);
  await sandbox.setTimeout(SANDBOX_TIMEOUT);
  const started = Date.now();
  let lastCode = '000';

  while (Date.now() - started < maxWaitMs) {
    try {
      /** No `-S` and trailing `|| true`: avoid E2B CommandExitError on refused connection / compile errors. */
      const result = await runSandboxCommand(
        sandbox,
        `bash -lc 'curl -s --max-time 12 -w "\\n__HTTP__%{http_code}" http://127.0.0.1:3000/ 2>/dev/null | tail -c 8000; exit 0'`,
        { timeoutMs: 20_000 }
      );
      const raw = result.stdout;
      const codeMatch = raw.match(/__HTTP__(\d{3})$/);
      lastCode = codeMatch?.[1] ?? '000';
      const body = raw.replace(/__HTTP__\d{3}$/, '');

      const textContent = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const hasAppShell =
        /<html[\s>]/i.test(body) &&
        (body.includes('__next') ||
          body.includes('<main') ||
          body.includes('id="root"') ||
          body.length > 400);
      const hasRenderableContent =
        body.includes('<main') ||
        textContent.length > 80 ||
        /next-error|data-next-error|Build Error|Failed to compile/i.test(body);
      const isBuildError =
        /Build Error|Application error|Module not found|Failed to compile/i.test(
          body
        );

      if ((lastCode === '200' || lastCode === '304') && hasAppShell) {
        // Surface compile/runtime errors in the iframe instead of an endless blank screen.
        if (isBuildError) {
          return { ready: true, httpCode: lastCode };
        }
        if (hasRenderableContent) {
          return { ready: true, httpCode: lastCode };
        }
      }
    } catch (e) {
      console.warn('[sandbox] waitForSandboxPreviewReady: probe failed', e);
    }

    await new Promise((r) => setTimeout(r, 3_000));
  }

  return { ready: false, httpCode: lastCode };
}

/**
 * Reconnects to the project's sandbox when still alive; otherwise creates a new one.
 */
export async function resolveOrCreateSandboxId(
  projectId: string,
  forceNew = false
): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { e2bSandboxId: true },
  });

  if (!forceNew && project?.e2bSandboxId) {
    try {
      const sandbox = await Sandbox.connect(project.e2bSandboxId);
      await sandbox.setTimeout(SANDBOX_TIMEOUT);
      return project.e2bSandboxId;
    } catch {
      // Sandbox expired or killed — create a fresh one below.
    }
  }

  const sandbox = await Sandbox.create(E2B_TEMPLATE_ID);
  await sandbox.setTimeout(SANDBOX_TIMEOUT);
  await ensureSandboxDevServerRunning(sandbox.sandboxId);
  return sandbox.sandboxId;
}

/**
 * Last persisted file map from the latest successful assistant fragment (for agent state + tool merge).
 */
export async function loadInitialAgentFilesFromLatestFragment(
  projectId: string
): Promise<Record<string, string>> {
  const msg = await prisma.message.findFirst({
    where: {
      projectId,
      type: 'RESULT',
      fragment: { isNot: null },
    },
    orderBy: { createdAt: 'desc' },
    include: { fragment: true },
  });

  if (!msg?.fragment?.files) {
    return {};
  }

  return fragmentFilesToRecord(msg.fragment.files);
}

/**
 * Rewrite tracked files into the sandbox so disk matches agent state after resume
 * or after replacing an expired sandbox.
 */
export async function syncSandboxFilesFromMap(
  sandboxId: string,
  files: Record<string, string>
): Promise<void> {
  const safe = stripProtectedPathsFromFileMap(files);
  const entries = Object.entries(safe).map(([path, content]) => ({
    path,
    content,
  }));
  if (entries.length > 0) {
    await writeSandboxProjectFiles(sandboxId, entries);
  }
  await ensureSandboxBootstrapFiles(sandboxId);
}

function toNodeId(path: string): string {
  return path.replace(/[^a-zA-Z0-9_/-]/g, '_');
}

function extractImports(content: string): string[] {
  const hits = content.matchAll(
    /(?:import\s.+?from\s+['"]([^'"]+)['"])|(?:require\(\s*['"]([^'"]+)['"]\s*\))/g
  );
  const out: string[] = [];
  for (const m of hits) {
    const value = m[1] ?? m[2];
    if (value) out.push(value);
  }
  return out;
}

function buildGraphArtifacts(files: Record<string, string>) {
  const filePaths = Object.keys(files).sort();
  const pathSet = new Set(filePaths);

  const nodes = filePaths.map((path) => ({
    id: toNodeId(path),
    label: path.split('/').pop() ?? path,
    source_file: path,
    type: 'code',
  }));

  const edges: Array<{
    source: string;
    target: string;
    relation: 'imports' | 'references';
    confidence: 'EXTRACTED' | 'INFERRED';
  }> = [];

  for (const [path, content] of Object.entries(files)) {
    const source = toNodeId(path);
    const imports = extractImports(content);
    for (const imp of imports) {
      if (imp.startsWith('.')) {
        const base = path.split('/').slice(0, -1).join('/');
        const guessed = `${base}/${imp}`
          .replace(/\/\.\//g, '/')
          .replace(/\/[^/]+\/\.\.\//g, '/');
        const targetPath = [...pathSet].find(
          (p) => p === guessed || p.startsWith(`${guessed}.`) || p.startsWith(`${guessed}/`)
        );
        if (targetPath) {
          edges.push({
            source,
            target: toNodeId(targetPath),
            relation: 'imports',
            confidence: 'EXTRACTED',
          });
          continue;
        }
      }
      const targetPath = filePaths.find((p) => p.includes(imp.replace(/^@\//, 'src/')));
      if (targetPath) {
        edges.push({
          source,
          target: toNodeId(targetPath),
          relation: 'references',
          confidence: 'INFERRED',
        });
      }
    }
  }

  const topFiles = filePaths
    .map((p) => {
      const lineCount = files[p].split('\n').length;
      const importCount = extractImports(files[p]).length;
      return { path: p, score: lineCount + importCount * 20 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const report = [
    '# Graphify Lite Report',
    '',
    `- Files indexed: ${filePaths.length}`,
    `- Relationships: ${edges.length}`,
    '',
    '## Important Files',
    ...topFiles.map((f) => `- ${f.path}`),
    '',
    '## Suggested Questions',
    '- Which files define the core app workflow?',
    '- What imports are most central?',
    '- Which project modules can be changed safely in isolation?',
  ].join('\n');

  const context = [
    '# Graph Context',
    `Files indexed: ${filePaths.length}`,
    'Top files:',
    ...topFiles.slice(0, 6).map((f) => `- ${f.path}`),
    'Key rule: prefer reading referenced files on demand instead of loading full repo context.',
  ].join('\n');

  return {
    graphJson: JSON.stringify({ nodes, edges }, null, 2),
    report,
    context,
    topFiles: topFiles.map((f) => f.path),
  };
}

function tokenizePrompt(prompt: string): string[] {
  return (prompt.toLowerCase().match(/[a-z0-9_/-]{3,}/g) ?? []).filter(Boolean);
}

function selectGraphRelevantFiles(
  files: Record<string, string>,
  topFiles: string[],
  prompt: string,
  maxFiles = 10
): string[] {
  const terms = tokenizePrompt(prompt);
  if (terms.length === 0) return topFiles.slice(0, maxFiles);

  const scored = Object.keys(files).map((path) => {
    const text = `${path}\n${files[path].slice(0, 3000)}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (text.includes(term)) score += 5;
    }
    if (topFiles.includes(path)) score += 3;
    if (path.includes('app/') || path.includes('src/')) score += 1;
    return { path, score };
  });

  const selected = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFiles)
    .map((s) => s.path);

  // Keep critical Next.js entry files in context when they exist.
  for (const core of ['app/page.tsx', 'app/layout.tsx', 'app/globals.css']) {
    if (files[core] && !selected.includes(core)) {
      selected.unshift(core);
    }
  }

  return selected.slice(0, maxFiles + 3);
}

/**
 * Writes Graphify-like artifacts into sandbox so each run can query compact
 * project context instead of re-sending large file maps.
 */
export async function syncGraphifyArtifactsToSandbox(
  sandboxId: string,
  files: Record<string, string>,
  userPrompt: string
): Promise<{ context: string; selectedFiles: Record<string, string> }> {
  const { graphJson, report, context, topFiles } = buildGraphArtifacts(files);
  const selectedPaths = selectGraphRelevantFiles(files, topFiles, userPrompt, 8);
  const selectedFiles = selectedPaths.reduce<Record<string, string>>((acc, path) => {
    const content = files[path];
    if (typeof content === 'string') acc[path] = content;
    return acc;
  }, {});

  await writeSandboxProjectFiles(sandboxId, [
    { path: GRAPH_JSON_PATH, content: graphJson },
    { path: GRAPH_REPORT_PATH, content: report },
    { path: GRAPH_CONTEXT_PATH, content: context },
    {
      path: GRAPH_SELECTED_PATH,
      content: JSON.stringify({ selectedPaths }, null, 2),
    },
  ]);

  return { context, selectedFiles };
}

export async function snapshotSandboxProjectFiles(
  sandboxIdOrConnected: string | Sandbox
): Promise<Record<string, string>> {
  const sandbox =
    typeof sandboxIdOrConnected === 'string'
      ? await Sandbox.connect(sandboxIdOrConnected)
      : sandboxIdOrConnected;
  await sandbox.setTimeout(SANDBOX_TIMEOUT);

  const script = String.raw`
import json
from pathlib import Path

def pick_project_root():
    candidates = [
        Path('/home/user'),
        Path('/workspace'),
        Path('/project'),
        Path('/repo'),
    ]
    for base in candidates:
        if not base.exists():
            continue
        if (base / 'package.json').is_file():
            return base
        if (base / 'app').is_dir() or (base / 'src').is_dir():
            return base
    return Path('/home/user')

root = pick_project_root()
allow_dirs = ['app', 'src', 'public', 'prisma', 'components', 'lib', 'hooks']
allow_files = {
  'package.json',
  'next.config.ts',
  'next.config.js',
  'tsconfig.json',
  'postcss.config.mjs',
  'tailwind.config.ts',
  'tailwind.config.js',
  'components.json',
}
ignore_parts = {'node_modules', '.next', '.git', '.turbo'}
max_bytes = 200_000

out = {}

for d in allow_dirs:
  base = root / d
  if not base.exists():
    continue
  for p in base.rglob('*'):
    if not p.is_file():
      continue
    rel = p.relative_to(root).as_posix()
    parts = set(rel.split('/'))
    if ignore_parts & parts:
      continue
    try:
      data = p.read_text(encoding='utf-8')
      if len(data.encode('utf-8')) <= max_bytes:
        out[rel] = data
    except Exception:
      pass

for f in allow_files:
  p = root / f
  if p.exists() and p.is_file():
    try:
      data = p.read_text(encoding='utf-8')
      if len(data.encode('utf-8')) <= max_bytes:
        out[f] = data
    except Exception:
      pass

print(json.dumps(out))
`;

  const command = `
if command -v python3 >/dev/null 2>&1; then
python3 - <<'PY'
${script}
PY
elif command -v python >/dev/null 2>&1; then
python - <<'PY'
${script}
PY
else
echo '{}'
fi
`;

  let raw = '';
  try {
    const result = await runSandboxCommand(sandbox, command);
    raw = (result.stdout ?? '').trim();
  } catch {
    return {};
  }

  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'string') {
        clean[k] = v;
      }
    }
    return clean;
  } catch {
    return {};
  }
}
