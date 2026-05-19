/** Commands that hang or are unnecessary in the pre-provisioned Next.js sandbox. */

export function blockedTerminalCommandReason(command: string): string | null {
  const c = command.trim();
  if (!c) return 'Empty command.';

  if (/^(npm|pnpm|yarn)\s+(install|i|ci|add)\b/i.test(c)) {
    return (
      'Package installs are disabled (dev server is already running with Shadcn UI + Tailwind). ' +
      'Use only existing dependencies — do not run npm install.'
    );
  }
  if (/^npx\s+(create-|degit|npm-check)/i.test(c)) {
    return 'Scaffolding commands are not allowed in this sandbox.';
  }
  if (/^(npm|pnpm|yarn)\s+run\s+(dev|start|build|test|lint)\b/i.test(c)) {
    return 'The dev server is already running on port 3000 — do not run build/test/dev scripts.';
  }
  if (/^(npx\s+)?(next|tsc|vitest|jest|playwright)\b/i.test(c)) {
    return 'Build/typecheck/test CLIs are disabled in the sandbox (use writeProjectFile instead).';
  }
  if (/^tail\s+-f\b/i.test(c) || /\bsleep\s+\d{3,}\b/.test(c)) {
    return 'Long-running or blocking shell commands are not allowed.';
  }

  return null;
}
