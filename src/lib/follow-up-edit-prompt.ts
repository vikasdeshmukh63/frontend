import { hasCustomSourceFiles } from '@/inngest/auto-wire-page';
import { isDefaultNextStarterPage } from '@/inngest/generation-guard';

/** Appended to the system prompt when the project already has generated source files. */
export const FOLLOW_UP_EDIT_RULES = `
## Follow-up edit mode (CRITICAL — this project already has working code)

The sandbox already contains a built app from earlier messages. The user is asking for a **targeted change**, not a rebuild.

### Scope (mandatory)
1. Change **only** what the user explicitly asked for — nothing else.
2. **readFiles** (and listFiles if needed) on every file you might touch **before** writeProjectFile. Never guess or rewrite from memory.
3. **Do not** rewrite unrelated files. Prefer editing 1–3 files over touching the whole tree.
4. **Do not** recreate the app, dashboard, or page layout from scratch. **Preserve** existing components, sections, styling, and behavior that the user did not ask to change.
5. **Do not** add new features, pages, nav items, sidebars, footers, sections, or mock data unless the user asked for them.
6. **Do not** refactor, rename, or reorganize files for style unless the user asked.
7. **Never** create or modify app/layout.tsx, src/app/layout.tsx, or any **/layout.tsx** under app/ or src/app/ — root and segment layouts are fixed.
8. **Never** modify app/globals.css, package.json, config files, or components/ui/*.
9. **Do not** change global chrome (navbar, sidebar, footer, page shell, grid wrapper) unless the user explicitly asked to change layout/navigation/structure.
10. **app/page.tsx** (or the active route page): **patch** the existing file — do **not** replace the whole page with a new design. If the change can live in a child component, edit or add that component instead of rewriting page.tsx.
11. When adding a feature: extend existing components or add **one** focused new component and wire it in — do not regenerate every file in the project.
12. Preserve existing imports, component names, copy, colors, spacing, and data unless the user asked to change them.

### Workflow
- listFiles "." → identify the smallest set of files involved.
- readFiles those paths → apply a minimal diff via writeProjectFile (one file per call).
- Skip writeProjectFile on files that do not need to change.
- Do **not** satisfy the "full page UI" or "rewrite app/page.tsx last" greenfield rules — they do not apply in follow-up mode.
- writeProjectFile will **reject** writes that look like a full-file rewrite of existing code — if rejected, read the file again and submit a smaller change.

### Completion
- When the requested change is done, output <task_summary> describing **only** what you changed (file names + brief behavior).
- If the request is ambiguous, make the smallest reasonable interpretation; do not expand scope.
`.trim();

const PRIMARY_PAGE_PATHS = ['app/page.tsx', 'src/app/page.tsx'] as const;

export function projectHasExistingApp(
  files: Record<string, string>
): boolean {
  if (Object.keys(files).length === 0) return false;
  if (hasCustomSourceFiles(files)) return true;

  for (const pagePath of PRIMARY_PAGE_PATHS) {
    const content = files[pagePath]?.trim();
    if (content && !isDefaultNextStarterPage(content)) {
      return true;
    }
  }

  return false;
}

/** Reject follow-up writes that replace most of an existing file instead of patching it. */
export function isLikelyFullRewrite(
  existingContent: string,
  newContent: string
): boolean {
  const existing = existingContent.trim();
  const next = newContent.trim();
  if (existing.length < 280) return false;
  if (next.length < existing.length * 0.55) return false;

  const existingLines = new Set(
    existing
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 8)
  );
  const newLines = next
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 8);

  if (newLines.length === 0) return false;

  let shared = 0;
  for (const line of newLines) {
    if (existingLines.has(line)) shared += 1;
  }

  const overlap = shared / newLines.length;
  return overlap < 0.22;
}

export function listExistingSourcePaths(
  files: Record<string, string>,
  max = 80
): string[] {
  return Object.keys(files)
    .map((p) => p.replace(/^\/+/, ''))
    .filter((p) => /\.(tsx|ts|jsx|js)$/.test(p))
    .sort()
    .slice(0, max);
}

export function buildFollowUpRunContext(params: {
  existingPaths: string[];
  userPrompt: string;
}): string {
  const paths =
    params.existingPaths.length > 0
      ? params.existingPaths.join('\n')
      : '(use listFiles to discover paths)';

  return [
    '<follow_up_edit>',
    'Mode: TARGETED EDIT on an existing codebase. Do not rebuild the app.',
    'The codebase on disk is the source of truth — read it before changing anything.',
    `User request: ${params.userPrompt}`,
    '',
    'Files already in this project (preserve unless the user asked to change them):',
    paths,
    '',
    'Only modify files required for the request above. Leave all other files unchanged.',
    '</follow_up_edit>',
  ].join('\n');
}
