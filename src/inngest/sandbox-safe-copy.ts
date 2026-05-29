/** Preinstalled in every sandbox — safe copy helper for iframe previews (no Clipboard API). */
export const SANDBOX_SAFE_COPY_TS = `'use client';

/**
 * Copy text in sandbox previews where navigator.clipboard is blocked.
 * Returns true when copy likely succeeded.
 */
export function copyTextSafe(text: string): boolean {
  if (!text) return false;
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    el.style.top = '0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
`;
