/** Avoid extra LLM round-trips for title/response after the main agent run. */

function extractTaskSummary(summary: string): string {
  const match = summary.match(/<task_summary>([\s\S]*?)<\/task_summary>/i);
  return match?.[1]?.trim() || summary.trim();
}

export function deriveFragmentTitle(prompt: string, summary: string): string {
  const base = extractTaskSummary(summary) || prompt;
  const words = base
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const stop = new Set([
    'a',
    'an',
    'the',
    'with',
    'for',
    'and',
    'to',
    'of',
    'in',
    'build',
    'create',
    'make',
  ]);
  const meaningful = words
    .filter((w) => !stop.has(w.toLowerCase()))
    .slice(0, 3);
  const title = (meaningful.length ? meaningful : words.slice(0, 3))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  return title.slice(0, 48) || 'Fragment';
}

export function deriveUserResponse(prompt: string, summary: string): string {
  const inner = extractTaskSummary(summary);
  if (inner && inner.length > 20 && inner.length < 600) {
    const short = inner.length > 280 ? `${inner.slice(0, 277)}…` : inner;
    return `Here's what I built for you — ${short}`;
  }
  const shortPrompt =
    prompt.length > 120 ? `${prompt.slice(0, 117)}…` : prompt;
  return `Here's your app based on: "${shortPrompt}". Open the preview and tell me if you want any changes.`;
}
