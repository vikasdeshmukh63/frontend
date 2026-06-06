import {
  normalizeSandboxRelativePath,
  snapshotSandboxProjectFiles,
  writeSandboxProjectFiles,
} from '@/inngest/project-sandbox';

const SOURCE_EXT = /\.(tsx|ts|jsx|js)$/;

/** Pre-installed sandbox modules — no agent file required. */
function isTemplateModuleBase(base: string): boolean {
  const b = base.replace(/\\/g, '/');
  if (b.startsWith('components/ui/')) return true;
  if (b === 'lib/utils' || b === 'lib/safe-copy') return true;
  return false;
}

function stripExtension(path: string): string {
  return path.replace(SOURCE_EXT, '');
}

function resolveRelativePath(fromDir: string, specifier: string): string {
  const parts = fromDir.split('/').filter(Boolean);
  for (const segment of specifier.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

/** Resolve `@/` or relative import to a sandbox path without extension. */
export function resolveLocalModuleBase(
  fromFile: string,
  specifier: string
): string | null {
  const spec = specifier.trim();
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return null;

  const from = normalizeSandboxRelativePath(fromFile);
  const fromDir = from.includes('/') ? from.replace(/\/[^/]+$/, '') : '';

  let base: string;
  if (spec.startsWith('@/')) {
    base = stripExtension(spec.slice(2));
  } else {
    base = stripExtension(resolveRelativePath(fromDir, spec));
  }

  return base.replace(/^\/+/, '') || null;
}

export function localModuleExists(
  moduleBase: string,
  files: Record<string, string>
): boolean {
  const base = moduleBase.replace(/\\/g, '/');
  const candidates = [
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    `${base}/index.tsx`,
    `${base}/index.ts`,
  ];
  return candidates.some((c) => c in files);
}

export type ParsedLocalImport = {
  specifier: string;
  defaultImport?: string;
  namedImports: string[];
  namespaceImport?: string;
};

function parseNamedImports(clause: string): string[] {
  const brace = clause.match(/\{([\s\S]*?)\}/);
  if (!brace?.[1]) return [];
  return brace[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const asMatch = part.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) return asMatch[2];
      return part.replace(/^type\s+/, '').split(/\s+/)[0];
    })
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

/** Extract local `@/` and relative imports from TS/TSX source. */
export function parseLocalImports(content: string): ParsedLocalImport[] {
  const results: ParsedLocalImport[] = [];
  const importRe =
    /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;

  for (const match of content.matchAll(importRe)) {
    const clause = match[1].trim();
    const specifier = match[2].trim();
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;

    const namespace = clause.match(/\*\s+as\s+(\w+)/);
    const namedImports = parseNamedImports(clause);
    let defaultImport: string | undefined;

    if (namespace) {
      /* namespace import only */
    } else if (namedImports.length === 0) {
      const simple = clause.match(/^(\w+)$/);
      if (simple) defaultImport = simple[1];
    } else {
      const withDefault = clause.match(/^(\w+)\s*,/);
      if (withDefault) defaultImport = withDefault[1];
    }

    results.push({
      specifier,
      defaultImport,
      namedImports,
      namespaceImport: namespace?.[1],
    });
  }

  return results;
}

export type MissingLocalModule = {
  moduleBase: string;
  writePath: string;
  defaultImport?: string;
  namedImports: Set<string>;
  namespaceImport?: string;
};

export function collectMissingLocalImports(
  files: Record<string, string>
): MissingLocalModule[] {
  const missing = new Map<string, MissingLocalModule>();

  for (const [filePath, content] of Object.entries(files)) {
    if (!/\.(tsx|ts|jsx|js)$/.test(filePath)) continue;

    for (const imp of parseLocalImports(content)) {
      const moduleBase = resolveLocalModuleBase(filePath, imp.specifier);
      if (!moduleBase || isTemplateModuleBase(moduleBase)) continue;
      if (localModuleExists(moduleBase, files)) continue;

      const existing = missing.get(moduleBase) ?? {
        moduleBase,
        writePath: `${moduleBase}.tsx`,
        namedImports: new Set<string>(),
      };

      if (imp.defaultImport) existing.defaultImport = imp.defaultImport;
      if (imp.namespaceImport) existing.namespaceImport = imp.namespaceImport;
      for (const name of imp.namedImports) existing.namedImports.add(name);

      missing.set(moduleBase, existing);
    }
  }

  return [...missing.values()];
}

function kebabToPascal(segment: string): string {
  return segment
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

function defaultNameFromPath(moduleBase: string): string {
  const file = moduleBase.split('/').pop() ?? 'Component';
  const base = file.replace(SOURCE_EXT, '');
  return kebabToPascal(base) || 'Component';
}

function buildPlaceholderBody(componentName: string, kind: 'table' | 'chart' | 'default'): string {
  if (kind === 'table') {
    return [
      `export function ${componentName}() {`,
      '  const rows = [',
      '    { id: "1", name: "Alpha Corp", status: "Active", amount: "$12,400" },',
      '    { id: "2", name: "Beta LLC", status: "Pending", amount: "$8,200" },',
      '    { id: "3", name: "Gamma Inc", status: "Active", amount: "$24,100" },',
      '  ];',
      '  return (',
      '    <Card>',
      '      <CardHeader><CardTitle>Data</CardTitle></CardHeader>',
      '      <CardContent className="overflow-x-auto">',
      '        <table className="w-full text-sm">',
      '          <thead>',
      '            <tr className="border-b text-left text-muted-foreground">',
      '              <th className="pb-2 pr-4 font-medium">Name</th>',
      '              <th className="pb-2 pr-4 font-medium">Status</th>',
      '              <th className="pb-2 font-medium">Amount</th>',
      '            </tr>',
      '          </thead>',
      '          <tbody>',
      '            {rows.map((row) => (',
      '              <tr key={row.id} className="border-b last:border-0">',
      '                <td className="py-2 pr-4">{row.name}</td>',
      '                <td className="py-2 pr-4">{row.status}</td>',
      '                <td className="py-2">{row.amount}</td>',
      '              </tr>',
      '            ))}',
      '          </tbody>',
      '        </table>',
      '      </CardContent>',
      '    </Card>',
      '  );',
      '}',
    ].join('\n');
  }

  if (kind === 'chart') {
    return [
      `export function ${componentName}() {`,
      '  return (',
      '    <Card>',
      '      <CardHeader><CardTitle>Chart</CardTitle></CardHeader>',
      '      <CardContent>',
      '        <div className="flex h-48 items-end gap-2">',
      '          {[40, 65, 45, 80, 55, 70].map((h, i) => (',
      '            <div',
      '              key={i}',
      '              className="bg-primary/80 flex-1 rounded-t-md"',
      '              style={{ height: `${h}%` }}',
      '            />',
      '          ))}',
      '        </div>',
      '      </CardContent>',
      '    </Card>',
      '  );',
      '}',
    ].join('\n');
  }

  return [
    `export function ${componentName}() {`,
    '  return (',
    '    <Card>',
    `      <CardHeader><CardTitle>${componentName}</CardTitle></CardHeader>`,
    '      <CardContent>',
    '        <p className="text-sm text-muted-foreground">Content placeholder</p>',
    '      </CardContent>',
    '    </Card>',
    '  );',
    '}',
  ].join('\n');
}

function inferComponentKind(name: string, moduleBase: string): 'table' | 'chart' | 'default' {
  const hint = `${name} ${moduleBase}`.toLowerCase();
  if (/table|grid|rows|listings|records|entries/.test(hint)) return 'table';
  if (/chart|graph|analytics|stats|metric|kpi/.test(hint)) return 'chart';
  return 'default';
}

export function buildStubModuleContent(module: MissingLocalModule): string {
  const names = new Set(module.namedImports);
  const defaultName =
    module.defaultImport ?? defaultNameFromPath(module.moduleBase);
  if (module.defaultImport) names.delete(module.defaultImport);

  const exportNames =
    names.size > 0 ? [...names] : module.defaultImport ? [] : [defaultName];

  const kind = inferComponentKind(
    exportNames[0] ?? defaultName,
    module.moduleBase
  );

  const lines = [
    "'use client';",
    '',
    "import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';",
    '',
  ];

  for (const name of exportNames) {
    lines.push(buildPlaceholderBody(name, inferComponentKind(name, module.moduleBase)));
    lines.push('');
  }

  if (module.defaultImport || exportNames.length === 0) {
    lines.push(`export default function ${defaultName}() {`);
    lines.push('  return (');
    if (exportNames.length === 1) {
      lines.push(`    <${exportNames[0]} />`);
    } else {
      lines.push('    <Card>');
      lines.push(`      <CardHeader><CardTitle>${defaultName}</CardTitle></CardHeader>`);
      lines.push('      <CardContent>');
      lines.push('        <p className="text-sm text-muted-foreground">Content placeholder</p>');
      lines.push('      </CardContent>');
      lines.push('    </Card>');
    }
    lines.push('  );');
    lines.push('}');
  }

  if (module.namespaceImport) {
    lines.push('');
    lines.push(`export const ${module.namespaceImport} = {};`);
  }

  return lines.join('\n');
}

/**
 * When the agent writes a file that imports missing modules, auto-create stub
 * components so the build succeeds immediately (agent can replace stubs later).
 */
export function autoStubMissingImportsForWrites(
  filesToWrite: { path: string; content: string }[],
  existingFiles: Record<string, string>
): { path: string; content: string }[] {
  const merged: Record<string, string> = { ...existingFiles };
  const stubs: { path: string; content: string }[] = [];
  const stubPaths = new Set<string>();

  for (const file of filesToWrite) {
    merged[file.path] = file.content;
  }

  for (const file of filesToWrite) {
    if (!/\.(tsx|ts|jsx|js)$/.test(file.path)) continue;
    const snapshot = { ...merged };
    for (const missing of collectMissingLocalImports(snapshot)) {
      if (localModuleExists(missing.moduleBase, merged)) continue;
      if (stubPaths.has(missing.writePath)) continue;
      const content = buildStubModuleContent(missing);
      stubs.push({ path: missing.writePath, content });
      stubPaths.add(missing.writePath);
      merged[missing.writePath] = content;
    }
  }

  return stubs.length > 0 ? [...stubs, ...filesToWrite] : filesToWrite;
}

/** Post-agent safety net: scaffold missing local modules so preview builds. */
export async function repairMissingLocalImports(
  sandboxId: string
): Promise<{ stubsCreated: number; paths: string[] }> {
  const files = await snapshotSandboxProjectFiles(sandboxId);
  const missing = collectMissingLocalImports(files);
  if (missing.length === 0) {
    return { stubsCreated: 0, paths: [] };
  }

  const writes = missing.map((module) => ({
    path: module.writePath,
    content: buildStubModuleContent(module),
  }));

  await writeSandboxProjectFiles(sandboxId, writes);
  return {
    stubsCreated: writes.length,
    paths: writes.map((w) => w.path),
  };
}
