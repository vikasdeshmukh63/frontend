'use client';

import ArcAuraFX from '@/components/arc-aura-fx';

/** Full-viewport ArcAuraFX background for the marketing home layout. */
export function HomeArcBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10"
      aria-hidden
    >
      <ArcAuraFX className="h-full w-full" />
    </div>
  );
}
