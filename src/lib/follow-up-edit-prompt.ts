import { hasCustomSourceFiles } from '@/inngest/auto-wire-page';

/** Appended to the system prompt when the project already has generated source files. */
export const FOLLOW_UP_EDIT_RULES = `
## Follow-up edit mode (CRITICAL — this project already has working code)

The sandbox already contains a built app from earlier messages. The user is asking for a **targeted change**, not a rebuild.

### Scope (mandatory)
1. Change **only** what the user explicitly asked for — nothing else.
2. **readFiles** (and listFiles if needed) on every file you might touch **before** writeProjectFile. Never guess or rewrite from memory.
3. **Do not** rewrite unrelated files. Prefer editing 1–3 files over touching the whole tree.
4. **Do not** add new features, pages, nav items, sidebars, footers, sections, or mock data unless the user asked for them.
5. **Do not** refactor, rename, or reorganize files for style unless the user asked.
6. **Never** create or modify app/layout.tsx, src/app/layout.tsx, or any **/layout.tsx** under app/ or src/app/ — root and segment layouts are fixed.
7. **Never** modify app/globals.css, package.json, config files, or components/ui/*.
8. **Do not** change global chrome (navbar, sidebar, footer, page shell, grid wrapper) unless the user explicitly asked to change layout/navigation/structure.
9. **app/page.tsx** (or the active route page): edit only the minimum lines needed. Do **not** replace the whole page with a new design. If the change can live in a child component, edit that component instead of page.tsx.
10. Preserve existing imports, component names, copy, colors, spacing, and data unless the user asked to change them.

### Workflow
- listFiles "." → identify the smallest set of files involved.
- readFiles those paths → apply a minimal diff via writeProjectFile (one file per call).
- Skip writeProjectFile on files that do not need to change.
- Do **not** satisfy the "full page UI" or "rewrite app/page.tsx last" greenfield rules — they do not apply in follow-up mode.

### Completion
- When the requested change is done, output <task_summary> describing **only** what you changed (file names + brief behavior).
- If the request is ambiguous, make the smallest reasonable interpretation; do not expand scope.
`.trim();

export function projectHasExistingApp(
  files: Record<string, string>
): boolean {
  return Object.keys(files).length > 0 && hasCustomSourceFiles(files);
}

export function listExistingSourcePaths(
  files: Record<string, string>,
  max = 60
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
    `User request: ${params.userPrompt}`,
    '',
    'Files already in this project (do not recreate from scratch):',
    paths,
    '</follow_up_edit>',
  ].join('\n');
}
