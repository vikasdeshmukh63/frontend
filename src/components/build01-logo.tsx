import { cn } from '@/lib/utils';

export type Build01LogoVariant = 'wordmark' | 'mark';

export type Build01LogoCutStroke = 'theme' | 'on-emphasis';

const ORANGE = '#ff5e14';

interface Build01LogoProps {
  className?: string;
  /** Approximate rendered height in px; width scales with aspect ratio */
  height?: number;
  variant?: Build01LogoVariant;
  /** Accessible name */
  title?: string;
  /**
   * Stroke for the horizontal “cut” and 01 outline.
   * `theme` — matches page background (light/dark via CSS variable).
   * `on-emphasis` — dark translucent stroke for white wordmark on vivid hero backgrounds.
   */
  cutStroke?: Build01LogoCutStroke;
}

function cutPaint(cutStroke: Build01LogoCutStroke): string {
  return cutStroke === 'on-emphasis'
    ? 'rgba(15, 23, 42, 0.42)'
    : 'var(--background)';
}

export function Build01Logo({
  className,
  height = 28,
  variant = 'wordmark',
  title = 'Build01',
  cutStroke = 'theme',
}: Build01LogoProps) {
  const stroke = cutPaint(cutStroke);

  if (variant === 'mark') {
    return (
      <svg
        role="img"
        aria-label={title}
        viewBox="0 0 88 44"
        xmlns="http://www.w3.org/2000/svg"
        className={cn('shrink-0', className)}
        style={{ height, width: 'auto' }}
      >
        <text
          x="2"
          y="33"
          fontFamily="var(--font-sans), ui-sans-serif, system-ui, sans-serif"
          fontWeight="900"
          fontSize="34"
          letterSpacing="-0.08em"
          fill={ORANGE}
          stroke={stroke}
          strokeWidth="1.35"
          paintOrder="stroke fill"
        >
          01
        </text>
        <line
          x1="0"
          y1="21"
          x2="86"
          y2="21"
          stroke={stroke}
          strokeWidth="2.5"
        />
      </svg>
    );
  }

  return (
    <svg
      role="img"
      aria-label={title}
      viewBox="0 0 248 44"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0 text-foreground', className)}
      style={{ height, width: 'auto', maxWidth: '100%' }}
    >
      <text
        x="2"
        y="33"
        fontFamily="var(--font-sans), ui-sans-serif, system-ui, sans-serif"
        fontWeight="900"
        fontSize="34"
        letterSpacing="-0.03em"
        fill="currentColor"
      >
        Build
      </text>
      <text
        x="136"
        y="33"
        fontFamily="var(--font-sans), ui-sans-serif, system-ui, sans-serif"
        fontWeight="900"
        fontSize="34"
        letterSpacing="-0.07em"
        fill={ORANGE}
        stroke={stroke}
        strokeWidth="1.35"
        paintOrder="stroke fill"
      >
        01
      </text>
      <line
        x1="0"
        y1="21"
        x2="248"
        y2="21"
        stroke={stroke}
        strokeWidth="2.5"
      />
    </svg>
  );
}
