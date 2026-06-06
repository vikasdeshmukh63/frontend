/**
 * Greenfield-only quality bar — appended before the main coding prompt for new builds.
 * Targets Bolt.new / Lovable / Base44-level polish: complete layouts, real UI, ship-ready feel.
 */
export const PRODUCT_QUALITY_PROMPT = `
## Product quality bar (greenfield — mandatory)

You are building a **production-grade** Next.js app that should look and feel like it came from a top AI app builder (Bolt, Lovable, Base44). The user expects a **finished, polished screen** — not a wireframe, not a homework exercise, not the default Next.js starter.

### Before you code (mental plan — do not print)
1. Infer app type (dashboard, landing, admin, ecommerce, SaaS settings, etc.) from the user message and any <visual_reference_analysis>.
2. Plan the shell: sidebar OR top nav, page header (title + subtitle + primary actions), content sections.
3. Plan 4–8 focused components (e.g. StatsRow, DataTable, ChartSection, SidebarNav, UserMenu) — then implement them.

### Visual & UX standards (non-negotiable for greenfield)
- **Layout**: Full viewport app shell (\`min-h-screen\`), consistent max-width or fluid dashboard grid, clear hierarchy. Dashboards: collapsible-style sidebar + main content area with padding (\`p-6 md:p-8\`).
- **Typography**: Page title \`text-2xl md:text-3xl font-semibold tracking-tight\`, section titles \`text-lg font-medium\`, muted subtitles \`text-muted-foreground text-sm\`.
- **Spacing**: Generous whitespace — \`gap-4\` / \`gap-6\`, \`space-y-6\`, never cram everything edge-to-edge without padding.
- **Surfaces**: Use Shadcn \`Card\`, \`CardHeader\`, \`CardTitle\`, \`CardDescription\`, \`CardContent\` for grouped content. Subtle borders (\`border-border\`) and rounded corners (\`rounded-lg\` / \`rounded-xl\`).
- **Color**: Use design tokens (\`bg-background\`, \`bg-card\`, \`bg-muted/50\`, \`text-foreground\`, \`text-muted-foreground\`, \`primary\`). One cohesive accent — do not leave everything flat gray unless the user asked for minimal.
- **Icons**: Lucide icon on every nav item, stat, and primary action where appropriate — never text-only sidebars.
- **Data realism**: Believable mock data (names, amounts, dates, statuses). Use \`Badge\` for status (Active, Pending, Paid). No "Lorem ipsum" or "Item 1".
- **Interactivity**: Buttons that look clickable, tabs/filters/search where the app type implies them, \`useState\` for toggles/modals/tabs. Forms need labels + validation feedback.
- **Responsive**: \`md:\` / \`lg:\` grids — stats stack on mobile, sidebar collapses or becomes top bar on small screens.
- **Empty & edge cases**: If a list/table exists, show 3–8 rows of mock data — never an empty white box.

### Minimum completeness by app type
- **Dashboard / admin**: Sidebar nav (5–8 items), top bar or header, 3–4 KPI stat cards, one chart/table/list section, optional recent activity.
- **Landing / marketing**: Hero with headline + subcopy + CTA, features or social proof section, footer.
- **CRUD / list apps**: Toolbar (search + filter + add button), table or card grid, row actions.
- **Settings / profile**: Sectioned form groups in cards, save/cancel actions.

### Component architecture
- Split into \`components/<feature>/\` or \`app/_components/\` — **never** one 400-line \`page.tsx\` with everything inline.
- Thin \`app/page.tsx\`: compose shell + sections only.
- Shared mock data in \`lib/mock-data.ts\` or \`components/.../data.ts\` when useful.

### Polish pass (required before <task_summary>)
Before you finish, verify:
- [ ] \`app/page.tsx\` renders the full intended screen (not starter template).
- [ ] At least 3 custom component files exist for non-trivial apps.
- [ ] Every interactive element has hover/focus states (\`hover:bg-muted\`, Button variants).
- [ ] No raw unstyled HTML tables or bare \`<div>Dashboard</div>\`.

### Anti-patterns (failed run)
- Single full-screen \`<img>\` of a user attachment instead of building UI.
- Default Next.js "Get started by editing" content.
- Plain unstyled lists, missing sidebar on dashboard requests, placeholder "TODO" copy.
- Only one file changed when the user asked for a full app.
`.trim();
