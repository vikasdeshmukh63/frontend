'use client';

/**
 * ArcAuraFX — animated aurora background (ported from Framer module).
 * @see https://framer.com/m/ArcAuraFX-B41rAF.js
 */
import * as React from 'react';

const HORIZON_Y = 78;
const BG_OVERLAY =
  'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 35%)';
const EASE_NATURAL = 'cubic-bezier(0.42, 0, 0.58, 1)';

export type ArcAuraFXProps = {
  background?: string;
  auroraPink?: string;
  auroraOrange?: string;
  auroraBlue?: string;
  auroraWhite?: string;
  auroraOpacity?: number;
  auroraBlur?: number;
  auroraSaturation?: number;
  auroraContrast?: number;
  auroraGrain?: number;
  arcShadow?: string;
  arcHeight?: number;
  arcBlur?: number;
  arcLift?: number;
  horizonGlow?: string;
  horizonGlowOpacity?: number;
  horizonGlowHeight?: number;
  starsEnabled?: boolean;
  starColor?: string;
  starOpacity?: number;
  starDensity?: number;
  starSize?: number;
  starSeed?: number;
  animationSpeed?: number;
  vignetteOpacity?: number;
  style?: React.CSSProperties;
  className?: string;
};

export default function ArcAuraFX(props: ArcAuraFXProps) {
  const {
    background = '#040810',
    auroraPink = 'rgba(110, 175, 240, 0.85)',
    auroraOrange = 'rgba(70, 130, 200, 0.7)',
    auroraBlue = 'rgba(30, 80, 160, 0.55)',
    auroraWhite = 'rgba(195, 220, 250, 0.92)',
    auroraOpacity = 1,
    auroraBlur = 24,
    auroraSaturation = 1.1,
    auroraContrast = 1.02,
    auroraGrain = 0.35,
    arcShadow = 'rgba(3, 6, 12, 1)',
    arcHeight = 300,
    arcBlur = 0,
    arcLift = 0,
    horizonGlow = 'rgba(170, 200, 235, 0.8)',
    horizonGlowOpacity = 0.5,
    horizonGlowHeight = 110,
    starsEnabled = true,
    starColor = 'rgba(255,255,255,1)',
    starOpacity = 0.8,
    starDensity = 1.4,
    starSize = 1,
    starSeed = 12,
    animationSpeed = 1.5,
    vignetteOpacity = 0.55,
    style,
    className,
  } = props;

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '');

  const drawStars = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!canvasRef.current || !wrapperRef.current) return;

    const canvas = canvasRef.current;
    const rect = wrapperRef.current.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    let s = Math.floor((starSeed || 1) * 1e6) || 123456;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };

    const count = Math.floor(Math.max(0, starDensity) * w * h * 45e-5);
    const maxR = Math.max(0.2, starSize);
    const horizonPx = (HORIZON_Y / 100) * h;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = starColor;

    for (let i = 0; i < count; i++) {
      const x = rand() * w;
      const y = rand() * h;
      if (y > horizonPx - 20) continue;

      const yNorm = y / Math.max(1, horizonPx);
      const haze = Math.min(1, Math.max(0, (yNorm - 0.55) / 0.45));
      if (rand() < haze * 0.7) continue;

      const xNorm = x / w;
      const inCone =
        Math.max(0, 1 - Math.abs(xNorm - 0.5) / 0.16) *
        Math.max(0, 1 - yNorm / 0.9);
      if (rand() < inCone * 0.5) continue;

      const tw = 0.4 + rand() * 0.6;
      const r = Math.max(0.25, (0.25 + rand() * maxR) * (0.7 + (1 - yNorm) * 0.5));
      const a = Math.min(1, Math.max(0, starOpacity * tw));

      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();

      if (rand() > 0.985) {
        ctx.globalAlpha = Math.min(1, a * 0.6);
        ctx.beginPath();
        ctx.arc(x, y, r * 3, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }, [starColor, starDensity, starOpacity, starSize, starSeed]);

  React.useEffect(() => {
    if (!starsEnabled) return;
    drawStars();

    let raf = 0;
    const onResize = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => drawStars());
    };

    window.addEventListener('resize', onResize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [starsEnabled, drawStars]);

  React.useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const update = () => {
      const w = el.offsetWidth;
      const scale = Math.min(1, Math.max(0.3, w / 800));
      el.style.setProperty('--blur-scale', String(scale));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const colorFilter = React.useMemo(() => {
    return `saturate(${Math.max(0, auroraSaturation)}) contrast(${Math.max(0, auroraContrast)})`;
  }, [auroraSaturation, auroraContrast]);

  const pillarCenter = React.useMemo(
    () =>
      `radial-gradient(ellipse 18% 95% at 50% ${HORIZON_Y}%, ${auroraPink} 0%, ${auroraPink} 4%, rgba(0,0,0,0) 60%)`,
    [auroraPink]
  );

  const pillarsInner = React.useMemo(
    () =>
      [
        `radial-gradient(ellipse 6% 95% at 30% ${HORIZON_Y}%, ${auroraOrange} 0%, rgba(0,0,0,0) 68%)`,
        `radial-gradient(ellipse 6% 95% at 70% ${HORIZON_Y}%, ${auroraOrange} 0%, rgba(0,0,0,0) 68%)`,
      ].join(', '),
    [auroraOrange]
  );

  const pillarsOuter = React.useMemo(
    () =>
      [
        `radial-gradient(ellipse 10% 75% at 14% ${HORIZON_Y}%, ${auroraOrange} 0%, rgba(0,0,0,0) 72%)`,
        `radial-gradient(ellipse 10% 75% at 86% ${HORIZON_Y}%, ${auroraOrange} 0%, rgba(0,0,0,0) 72%)`,
      ].join(', '),
    [auroraOrange]
  );

  const atmosphere = React.useMemo(
    () =>
      [
        `radial-gradient(ellipse 22% 4% at 50% ${HORIZON_Y - 0.5}%, ${auroraWhite} 0%, rgba(0,0,0,0) 80%)`,
        `radial-gradient(ellipse 38% 9% at 50% ${HORIZON_Y - 1}%, ${auroraPink} 0%, rgba(0,0,0,0) 75%)`,
        `radial-gradient(ellipse 80% 14% at 50% ${HORIZON_Y - 0.5}%, ${auroraOrange} 0%, rgba(0,0,0,0) 75%)`,
        `radial-gradient(ellipse 95% 18% at 50% ${HORIZON_Y - 4}%, ${auroraBlue} 0%, rgba(0,0,0,0) 80%)`,
      ].join(', '),
    [auroraWhite, auroraPink, auroraOrange, auroraBlue]
  );

  const grainOverlay = React.useMemo(() => {
    const g = Math.max(0, Math.min(1, auroraGrain));
    return [
      `radial-gradient(circle at 10% 20%, rgba(255,255,255,${0.12 * g}) 0 1px, rgba(0,0,0,0) 2px)`,
      `radial-gradient(circle at 80% 30%, rgba(255,255,255,${0.08 * g}) 0 1px, rgba(0,0,0,0) 2px)`,
      `radial-gradient(circle at 50% 70%, rgba(255,255,255,${0.06 * g}) 0 1px, rgba(0,0,0,0) 2px)`,
    ].join(', ');
  }, [auroraGrain]);

  const planetStyles = React.useMemo((): React.CSSProperties => {
    const sizePct = Math.max(180, Math.min(900, arcHeight * 1.6));
    const lift = Math.max(-40, Math.min(140, arcLift));
    const blur = Math.max(0, arcBlur);

    return {
      position: 'absolute',
      width: `${sizePct}%`,
      aspectRatio: '1 / 1',
      left: '50%',
      top: `${HORIZON_Y}%`,
      transform: `translateX(-50%) translateY(${lift}px)`,
      borderRadius: '50%',
      background: arcShadow,
      boxShadow: `
        0 -2px 22px ${horizonGlow},
        0 -6px 60px ${horizonGlow},
        0 0 140px rgba(120, 170, 230, 0.22),
        0 0 260px rgba(50, 100, 180, 0.14)
      `,
      filter: blur > 0 ? `blur(${blur}px)` : undefined,
      opacity: Math.max(0, Math.min(1, horizonGlowOpacity * 0.75 + 0.25)),
      pointerEvents: 'none',
    };
  }, [arcHeight, arcLift, arcBlur, arcShadow, horizonGlow, horizonGlowOpacity]);

  const horizonCoreStyles = React.useMemo((): React.CSSProperties => {
    const lift = Math.max(-40, Math.min(140, arcLift));
    const hh = Math.max(40, horizonGlowHeight);

    return {
      position: 'absolute',
      left: 0,
      right: 0,
      top: `calc(${HORIZON_Y}% + ${lift - hh / 2}px)`,
      height: `${hh}px`,
      background: `radial-gradient(75% 60% at 50% 100%, ${horizonGlow} 0%, rgba(0,0,0,0) 78%)`,
      opacity: Math.max(0, Math.min(1, horizonGlowOpacity * 0.6)),
      filter: `blur(calc(${Math.max(0, auroraBlur * 0.5 + 4)}px * var(--blur-scale, 0.5)))`,
      transform: 'translateZ(0)',
      pointerEvents: 'none',
      mixBlendMode: 'screen',
    };
  }, [arcLift, horizonGlow, horizonGlowHeight, horizonGlowOpacity, auroraBlur]);

  const vignette = React.useMemo(() => {
    const v = Math.max(0, Math.min(1, vignetteOpacity));
    return `radial-gradient(120% 120% at 50% 40%, rgba(0,0,0,0) 55%, rgba(0,0,0,${v}) 100%)`;
  }, [vignetteOpacity]);

  const speed = Math.max(1e-4, animationSpeed);
  const animEnabled = animationSpeed > 0;
  const tCenter = 13 / speed;
  const tInner = 17 / speed;
  const tOuter = 19 / speed;
  const tHorizon = 11 / speed;

  const keyframes = animEnabled
    ? `
@keyframes aurora-center-${uid} {
  0%   { transform: translate3d(0, 0, 0) scale(1, 1); opacity: calc(var(--ho) * 0.97); }
  50%  { transform: translate3d(0, -1.5%, 0) scale(1.01, 1.08); opacity: calc(var(--ho) * 1.06); }
  100% { transform: translate3d(0, 0, 0) scale(1, 1); opacity: calc(var(--ho) * 0.97); }
}
@keyframes aurora-left-${uid} {
  0%   { transform: translate3d(0, 1.3%, 0) scale(0.99, 0.93); opacity: calc(var(--ho) * 0.88); }
  50%  { transform: translate3d(0, -2.7%, 0) scale(1, 1.14); opacity: calc(var(--ho) * 1.10); }
  100% { transform: translate3d(0, 1.3%, 0) scale(0.99, 0.93); opacity: calc(var(--ho) * 0.88); }
}
@keyframes aurora-right-${uid} {
  0%   { transform: translate3d(0, -1.0%, 0) scale(1, 1.04); opacity: calc(var(--ho) * 0.97); }
  50%  { transform: translate3d(0, -2.9%, 0) scale(1.02, 1.16); opacity: calc(var(--ho) * 1.10); }
  100% { transform: translate3d(0, -1.0%, 0) scale(1, 1.04); opacity: calc(var(--ho) * 0.97); }
}
@keyframes horizon-pulse-${uid} {
  0%   { opacity: calc(var(--ho) * 0.92); transform: scaleY(1); }
  50%  { opacity: calc(var(--ho) * 1.09); transform: scaleY(1.15); }
  100% { opacity: calc(var(--ho) * 0.92); transform: scaleY(1); }
}
`
    : '';

  const layerBase: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    transform: 'translateZ(0)',
    willChange: 'transform, opacity',
  };

  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{
        ...style,
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: background,
        backgroundImage: BG_OVERLAY,
        transform: 'translateZ(0)',
        isolation: 'isolate',
        ['--ho' as string]: String(Math.max(0, Math.min(1, auroraOpacity))),
      }}
      aria-label="Aurora over a curved horizon"
      role="img"
    >
      {animEnabled ? <style>{keyframes}</style> : null}
      {starsEnabled ? (
        <canvas
          ref={canvasRef}
          style={{ ...layerBase, width: '100%', height: '100%', opacity: 1 }}
          aria-hidden
        />
      ) : null}
      <div
        aria-hidden
        style={{
          ...layerBase,
          backgroundImage: pillarsOuter,
          opacity: Math.max(0, Math.min(1, auroraOpacity * 0.9)),
          filter: `${colorFilter} blur(calc(${Math.max(0, auroraBlur * 1.1)}px * var(--blur-scale, 0.5)))`,
          mixBlendMode: 'screen',
          transformOrigin: '50% 100%',
          animation: animEnabled
            ? `aurora-left-${uid} ${tOuter}s ${EASE_NATURAL} infinite`
            : undefined,
        }}
      />
      <div
        aria-hidden
        style={{
          ...layerBase,
          backgroundImage: pillarsInner,
          opacity: Math.max(0, Math.min(1, auroraOpacity)),
          filter: `${colorFilter} blur(calc(${Math.max(0, auroraBlur * 0.85)}px * var(--blur-scale, 0.5)))`,
          mixBlendMode: 'screen',
          transformOrigin: '50% 100%',
          animation: animEnabled
            ? `aurora-right-${uid} ${tInner}s ${EASE_NATURAL} infinite`
            : undefined,
        }}
      />
      <div
        aria-hidden
        style={{
          ...layerBase,
          backgroundImage: pillarCenter,
          opacity: Math.max(0, Math.min(1, auroraOpacity)),
          filter: `${colorFilter} blur(calc(${Math.max(0, auroraBlur * 0.75)}px * var(--blur-scale, 0.5)))`,
          mixBlendMode: 'screen',
          transformOrigin: '50% 100%',
          animation: animEnabled
            ? `aurora-center-${uid} ${tCenter}s ${EASE_NATURAL} infinite`
            : undefined,
        }}
      />
      <div
        aria-hidden
        style={{
          ...layerBase,
          backgroundImage: atmosphere,
          opacity: Math.max(0, Math.min(1, auroraOpacity)),
          filter: `${colorFilter} blur(calc(${Math.max(0, auroraBlur * 0.45)}px * var(--blur-scale, 0.5)))`,
          mixBlendMode: 'screen',
          transformOrigin: '50% 100%',
          animation: animEnabled
            ? `horizon-pulse-${uid} ${tHorizon}s ${EASE_NATURAL} infinite`
            : undefined,
        }}
      />
      {auroraGrain > 0 ? (
        <div
          aria-hidden
          style={{
            ...layerBase,
            backgroundImage: grainOverlay,
            backgroundSize: '240px 240px, 280px 280px, 320px 320px',
            backgroundRepeat: 'repeat',
            mixBlendMode: 'overlay',
            opacity: 1,
            filter: 'blur(0.15px)',
          }}
        />
      ) : null}
      <div aria-hidden style={planetStyles} />
      <div aria-hidden style={horizonCoreStyles} />
      <div aria-hidden style={{ ...layerBase, backgroundImage: vignette }} />
    </div>
  );
}