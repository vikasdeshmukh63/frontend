import {
  normalizeSandboxRelativePath,
  writeSandboxProjectFiles,
} from '@/inngest/project-sandbox';

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
    <html lang="en">
      <body
        className={\`\${geistSans.variable} \${geistMono.variable} min-h-screen antialiased\`}
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
  };
}

/**
 * Restores a valid root layout + globals on disk so Next.js dev server can run.
 */
export async function ensureSandboxBootstrapFiles(sandboxId: string): Promise<void> {
  const bootstrap = getSandboxBootstrapFiles();
  await writeSandboxProjectFiles(
    sandboxId,
    Object.entries(bootstrap).map(([path, content]) => ({ path, content }))
  );
}

/** Merge bootstrap into a fragment file map for persistence (without agent-broken layouts). */
export function mergeBootstrapIntoFileMap(
  files: Record<string, string>
): Record<string, string> {
  return {
    ...stripProtectedPathsFromFileMap(files),
    ...getSandboxBootstrapFiles(),
  };
}
