import {
  normalizeSandboxRelativePath,
  writeSandboxProjectFiles,
} from '@/inngest/project-sandbox';
import { SANDBOX_SAFE_COPY_TS } from '@/inngest/sandbox-safe-copy';
import { sanitizeFileMap } from '@/inngest/source-sanitize';

/** Matches create-next-app + shadcn template — required for Next.js 15 App Router. */
export const DEFAULT_APP_LAYOUT = `import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "App",
  description: "Generated app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta httpEquiv="Permissions-Policy" content="clipboard-write=(self)" />
      </head>
      <body
        className={\`\${geistSans.variable} \${geistMono.variable} min-h-screen bg-background text-foreground antialiased\`}
      >
        {children}
      </body>
    </html>
  );
}
`;

const PROTECTED_EXACT = new Set([
  'app/layout.tsx',
  'src/app/layout.tsx',
  'lib/safe-copy.ts',
  'app/globals.css',
  'src/app/globals.css',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'tsconfig.json',
  'postcss.config.mjs',
  'postcss.config.js',
  'tailwind.config.ts',
  'tailwind.config.js',
  'components.json',
]);

export function isProtectedSandboxPath(path: string): boolean {
  const rel = normalizeSandboxRelativePath(path).toLowerCase();
  if (PROTECTED_EXACT.has(rel)) return true;
  if (rel.startsWith('components/ui/')) return true;
  return false;
}

export function isValidRootLayoutContent(content: string): boolean {
  return /<html[\s>]/i.test(content) && /<body[\s>]/i.test(content);
}

/** Root page.tsx must not declare document shell — only app/layout.tsx may. */
export function pageHasIllegalDocumentShell(content: string): boolean {
  return (
    /<html[\s>]/i.test(content) ||
    /<\/html>/i.test(content) ||
    /<body[\s>]/i.test(content) ||
    /<\/body>/i.test(content)
  );
}

export function isRootLayoutPath(path: string): boolean {
  const rel = normalizeSandboxRelativePath(path).toLowerCase();
  return rel === 'app/layout.tsx' || rel === 'src/app/layout.tsx';
}

/** Any App Router layout.tsx (root or segment) — agents must not replace these on follow-ups. */
export function isAppLayoutPath(path: string): boolean {
  const rel = normalizeSandboxRelativePath(path).toLowerCase();
  if (!rel.endsWith('/layout.tsx') && rel !== 'app/layout.tsx' && rel !== 'src/app/layout.tsx') {
    return false;
  }
  return rel.startsWith('app/') || rel.startsWith('src/app/');
}

export function isRootPagePath(path: string): boolean {
  const rel = normalizeSandboxRelativePath(path).toLowerCase();
  return rel === 'app/page.tsx' || rel === 'src/app/page.tsx';
}

export function stripProtectedPathsFromFileMap(
  files: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (!isProtectedSandboxPath(path)) {
      out[normalizeSandboxRelativePath(path)] = content;
    }
  }
  return out;
}

/** Canonical bootstrap files always written to the sandbox (agent cannot override). */
export function getSandboxBootstrapFiles(): Record<string, string> {
  return {
    'app/layout.tsx': DEFAULT_APP_LAYOUT,
    'lib/safe-copy.ts': SANDBOX_SAFE_COPY_TS,
  };
}

/**
 * Restores a valid root layout + globals on disk so Next.js dev server can run.
 */
export async function ensureSandboxBootstrapFiles(sandboxId: string): Promise<void> {
  const { getSandbox } = await import('@/inngest/utils');
  const { toSandboxAbsolutePath } = await import('@/inngest/project-sandbox');
  const bootstrap = getSandboxBootstrapFiles();
  const files = Object.entries(bootstrap).map(([path, content]) => ({
    path,
    content,
  }));

  try {
    const sandbox = await getSandbox(sandboxId);
    const srcPage = await sandbox.files.read(
      toSandboxAbsolutePath('src/app/page.tsx')
    );
    if (typeof srcPage === 'string' && srcPage.trim().length > 0) {
      files.push({ path: 'src/app/layout.tsx', content: DEFAULT_APP_LAYOUT });
    }
  } catch {
    /* app router lives under /app only */
  }

  await writeSandboxProjectFiles(sandboxId, files);
}

/** Merge bootstrap into a fragment file map for persistence (without agent-broken layouts). */
export function mergeBootstrapIntoFileMap(
  files: Record<string, string>
): Record<string, string> {
  return {
    ...sanitizeFileMap(stripProtectedPathsFromFileMap(files)),
    ...getSandboxBootstrapFiles(),
  };
}
