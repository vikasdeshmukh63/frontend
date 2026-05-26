import { cn } from '@/lib/utils';

export type Build01LogoVariant = 'wordmark' | 'mark';

/** @deprecated Use `onDarkBackground` instead. Kept for call-site compatibility. */
export type Build01LogoCutStroke = 'theme' | 'on-emphasis';

interface Build01LogoProps {
  className?: string;
  /** Approximate rendered height in px; width scales with aspect ratio. */
  height?: number;
  /** Both variants use the same wordmark assets; `mark` renders slightly smaller. */
  variant?: Build01LogoVariant;
  /** Accessible name */
  title?: string;
  /**
   * When true, always shows `/logodark.png` (for vivid/dark sections like the home hero).
   * When false, follows app theme: `logolight.png` in light mode, `logodark.png` in dark mode.
   */
  onDarkBackground?: boolean;
  /** @deprecated No-op; use `onDarkBackground` for hero sections. */
  cutStroke?: Build01LogoCutStroke;
}

const LOGO_LIGHT = '/logolight.png';
const LOGO_DARK = '/logodark.png';

export function Build01Logo({
  className,
  height = 28,
  variant = 'wordmark',
  title = 'Build01',
  onDarkBackground = false,
  cutStroke,
}: Build01LogoProps) {
  const resolvedHeight = variant === 'mark' ? Math.round(height * 0.72) : height;

  if (onDarkBackground || cutStroke === 'on-emphasis') {
    return (
      <img
        src={LOGO_DARK}
        alt={title}
        className={cn('h-auto w-auto max-w-full shrink-0', className)}
        style={{ height: resolvedHeight }}
      />
    );
  }

  return (
    <span className={cn('inline-flex shrink-0', className)} role="img" aria-label={title}>
      <img
        src={LOGO_LIGHT}
        alt=""
        aria-hidden
        className="h-auto w-auto max-w-full dark:hidden"
        style={{ height: resolvedHeight }}
      />
      <img
        src={LOGO_DARK}
        alt=""
        aria-hidden
        className="hidden h-auto w-auto max-w-full dark:block"
        style={{ height: resolvedHeight }}
      />
    </span>
  );
}
