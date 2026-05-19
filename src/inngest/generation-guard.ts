/** Detect the default create-next-app landing page still on disk. */
export function isDefaultNextStarterPage(content: string): boolean {
  const c = content.toLowerCase();
  if (c.includes('get started by editing')) return true;
  if (c.includes('next.svg') && c.includes('deploy now')) return true;
  return false;
}

const PRIMARY_PAGE_PATHS = ['app/page.tsx', 'src/app/page.tsx'] as const;

export function agentStateHasBuiltAppPage(
  files: Record<string, string>
): boolean {
  for (const path of PRIMARY_PAGE_PATHS) {
    const content = files[path]?.trim();
    if (content && !isDefaultNextStarterPage(content)) {
      return true;
    }
  }
  return false;
}

export function snapshotHasBuiltAppPage(
  files: Record<string, string>
): boolean {
  return agentStateHasBuiltAppPage(files);
}

