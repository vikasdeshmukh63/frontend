import { cn } from '@/lib/utils';
import { Rubik_Mono_One } from 'next/font/google';

export type Build01LogoVariant = 'wordmark' | 'mark';

/** @deprecated Use `onDarkBackground` instead. Kept for call-site compatibility. */
export type Build01LogoCutStroke = 'theme' | 'on-emphasis';

const logoFont = Rubik_Mono_One({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
});

interface Build01LogoProps {
  className?: string;
  /** Font size in px */
  height?: number;
  variant?: Build01LogoVariant;
  title?: string;
  onDarkBackground?: boolean;
  /** @deprecated No-op */
  cutStroke?: Build01LogoCutStroke;
}

export function Build01Logo({
  className,
  height = 28,
  variant = 'wordmark',
  title = 'Build01',
  onDarkBackground = false,
  cutStroke,
}: Build01LogoProps) {
  const baseColorClass =
    onDarkBackground || cutStroke === 'on-emphasis' ? 'text-white' : 'text-foreground';

  return (
    <span
      className={cn('inline-flex items-center shrink-0 select-none', logoFont.className, className)}
      role="img"
      aria-label={title}
      style={{
        fontSize: height,
        lineHeight: 1,
      }}
    >
      {variant === 'wordmark' ? (
        <>
          <span className={baseColorClass}>Build</span>
          <span className="text-orange-500">01</span>
        </>
      ) : (
        <span className="text-orange-500">01</span>
      )}
    </span>
  );
}
