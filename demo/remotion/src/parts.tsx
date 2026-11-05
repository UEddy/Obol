import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { C, F } from "./theme";

/* Warm paper desk with a slow light drift and grain, like the reel's tabletop. */
export const Desk: React.FC<{ children?: React.ReactNode; light?: number }> = ({ children, light = 0.2 }) => {
  const frame = useCurrentFrame();
  const x = 18 + Math.sin(frame / 90) * 6;
  return (
    <AbsoluteFill style={{ background: C.paper, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(110% 90% at ${x}% 0%, rgba(255,255,255,0.65), transparent 60%),
                       radial-gradient(90% 90% at 100% 110%, rgba(70,50,25,${light + 0.12}), transparent 70%)`,
        }}
      />
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, opacity: 0.4, mixBlendMode: "multiply" }}>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves={3} seed={(frame % 6) + 1} stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 0 0.12  0 0 0 0.22 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
      {children}
    </AbsoluteFill>
  );
};

/* Ruled index card. */
export const Card: React.FC<{
  w: number; h: number; style?: React.CSSProperties; children?: React.ReactNode; header?: number; radius?: number;
}> = ({ w, h, style, children, header = 86, radius = 16 }) => (
  <div
    style={{
      width: w, height: h, borderRadius: radius, position: "absolute",
      background: `linear-gradient(transparent ${header}px, ${C.ruleStrong} ${header}px, ${C.ruleStrong} ${header + 2}px, transparent ${header + 2}px),
                   repeating-linear-gradient(to bottom, transparent 0, transparent 37px, ${C.rule} 37px, ${C.rule} 39px) 0 ${header + 2}px / 100% calc(100% - ${header + 2}px) no-repeat,
                   ${C.card}`,
      boxShadow: "0 1px 0 rgba(255,255,255,.7) inset, 0 40px 60px -30px rgba(48,36,20,.55), 0 8px 14px -6px rgba(48,36,20,.35)",
      ...style,
    }}
  >
    {children}
  </div>
);

export const Display: React.FC<{ size: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ size, children, style }) => (
  <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: size, lineHeight: 0.9, letterSpacing: "-0.04em", textTransform: "uppercase", color: C.ink, ...style }}>
    {children}
  </div>
);

/* Rubber stamp that slams down at `at` frames. */
export const Stamp: React.FC<{
  at: number; text: string; color?: string; size?: number; rotate?: number; style?: React.CSSProperties; dashed?: boolean;
}> = ({ at, text, color = C.stamp, size = 44, rotate = -11, style, dashed }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 11, stiffness: 220, mass: 0.6 } });
  const scale = interpolate(s, [0, 1], [2.4, 1]);
  const opacity = interpolate(frame - at, [0, 3], [0, 0.92], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const id = `stampgrain-${text.replace(/\W/g, "")}-${at}`;
  return (
    <div style={{ position: "absolute", transform: `rotate(${rotate}deg) scale(${scale})`, opacity, mixBlendMode: "multiply", ...style }}>
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={7} result="n" />
          <feColorMatrix in="n" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 1.8" result="m" />
          <feComposite in="SourceGraphic" in2="m" operator="in" />
        </filter>
      </svg>
      <div
        style={{
          filter: `url(#${id})`, color, border: `${Math.round(size / 9)}px ${dashed ? "dashed" : "solid"} ${color}`,
          outline: dashed ? "none" : `${Math.max(2, Math.round(size / 18))}px solid ${color}`, outlineOffset: size / 8,
          padding: `${size * 0.18}px ${size * 0.32}px ${size * 0.1}px`, borderRadius: 6,
          fontFamily: '"Inter Tight", Arial Black, sans-serif', fontWeight: 900, fontSize: size, letterSpacing: "0.05em",
          textTransform: "uppercase", whiteSpace: "nowrap", lineHeight: 1,
        }}
      >
        {text}
      </div>
    </div>
  );
};

/* Bottom subtitle, styled like the reel's captions. */
export const Caption: React.FC<{ text: string; from?: number; to: number }> = ({ text, from = 0, to }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [from, from + 10, to - 10, to], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, textAlign: "center", opacity: o,
      fontFamily: F.grot, fontWeight: 500, fontSize: 46, letterSpacing: "-0.01em", color: "#fbf8f2",
      textShadow: "0 2px 3px rgba(30,20,10,.65), 0 0 22px rgba(30,20,10,.45)" }}>
      {text}
    </div>
  );
};

/* Halftone coin (an obol), drawn as dot screens like the reel's halftone hand. */
export const Coin: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => {
  const dots: React.ReactNode[] = [];
  const step = size / 34;
  const r = size / 2;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const dx = x - r, dy = y - r, d = Math.hypot(dx, dy) / r;
      if (d > 1) continue;
      // light from top-left; rim darker; a raised inner ring
      const shade = 0.25 + 0.55 * ((dx + dy) / (2 * r) + 0.5) + (d > 0.86 ? 0.35 : 0) + (Math.abs(d - 0.55) < 0.05 ? 0.3 : 0);
      const rad = Math.max(0.4, Math.min(step * 0.62, step * 0.62 * shade));
      dots.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={rad} fill={C.ink} />);
    }
  }
  return (
    <svg width={size} height={size} style={{ position: "absolute", overflow: "visible", ...style }}>
      <defs>
        <radialGradient id="coinshadow"><stop offset="0" stopColor="rgba(40,28,12,.55)" /><stop offset="1" stopColor="rgba(40,28,12,0)" /></radialGradient>
      </defs>
      <ellipse cx={r + size * 0.08} cy={r + size * 0.1} rx={r * 1.05} ry={r * 1.05} fill="url(#coinshadow)" />
      <circle cx={r} cy={r} r={r} fill={C.paperDeep} />
      {dots}
      <text x={r} y={r + size * 0.06} textAnchor="middle" fontFamily='"Inter Tight", sans-serif' fontWeight={900}
        fontSize={size * 0.17} fill={C.paper} letterSpacing="-0.02em">OBOL</text>
    </svg>
  );
};

export const ease = (frame: number, a: number, b: number, from: number, to: number) =>
  interpolate(frame, [a, b], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
