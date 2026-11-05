import React from "react";
import {
  AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";
import captions from "../captions.json";
import views from "../public/captures/views.json";
import { C, F, FPS } from "./theme";

/*
 * The Obol demo: nine beats, each at least as long as its narration clip (public/audio/beatN.mp3, timed in
 * captions.json). Every shot is real footage from demo/capture: VHS recordings of the Hermes CLI (trigger,
 * attack, guard) and Playwright recordings of Stripe's hosted invoice page and the Obol dashboard. Segments
 * only choose a time range, a playback rate and a region to frame; sped-up stretches are labelled with their
 * rate. Graphics on top (transitions, highlight boxes, stamps) point at what the footage shows.
 */

type Box = [number, number, number, number]; // x, y, w, h in the 1920x1080 source
type Mark = { box: Box; card: number; note?: string };           // draw a box when caption card `card` starts
type Seg = {
  src: string; from: number; to: number; rate?: number;
  box?: Box; zoomFrom?: Box; label?: string; dim?: number;
  marks?: Mark[]; stampAt?: number;                              // stampAt: source second of a real deny
  enter?: Inner;                                                 // transition into this segment
};
type Inner = "zoom" | "whip";
type Outer = { kind: "slab"; label?: string; tone?: "ink" | "magenta" | "paper" } | { kind: "whip"; dir: 1 | -1 } | { kind: "flash" };
type Beat = { audio: number; segs: Seg[]; close?: boolean; next?: Outer };

const TERM: Box = [20, 0, 1320, 1080];
const FULL: Box = [0, 0, 1920, 1080];
const APPROVAL: Box = [40, 290, 1130, 530];
const o = views.overdue;
const OVERDUE: Box = [o.x - 40, o.y - 30, o.width + 80, o.height + 60];
const TABLE_TOP: Box = [290, 470, 1570, 360];
const SEC_TOP: Box = [290, 100, 1570, 620];
const CLI = "Hermes CLI · Stripe test mode";
const WALLET = CLI + " · wallet plugin: agentwalletapi";

const BEATS: Beat[] = [
  { audio: 1, next: { kind: "flash" }, segs: [
    { src: "views.webm", from: 3.4, to: 9.3, rate: 0.92, dim: 0.5, box: [60, 20, 1800, 1013], zoomFrom: [-120, -70, 2160, 1215], label: "Obol dashboard in Hermes" }] },
  { audio: 2, next: { kind: "slab", label: "The invoice", tone: "ink" }, segs: [
    { src: "views.webm", from: 3.6, to: 9.3, rate: 0.95, box: OVERDUE, zoomFrom: FULL, label: "Obol dashboard in Hermes" }] },
  { audio: 3, next: { kind: "whip", dir: -1 }, segs: [
    { src: "trigger.mp4", from: 0, to: 3.6, rate: 1.4, box: TERM, label: CLI },
    { src: "trigger.mp4", from: 3.6, to: 21.5, rate: 9, box: TERM, label: CLI, enter: "zoom" },
    { src: "trigger.mp4", from: 21.5, to: 24.6, box: [20, 0, 1300, 560], zoomFrom: TERM, label: CLI, enter: "zoom" },
  ] },
  { audio: 4, next: { kind: "slab", label: "Getting paid", tone: "ink" }, segs: [
    { src: "trigger.mp4", from: 25.8, to: 29.0, rate: 1.6, box: TERM, label: CLI },
    { src: "trigger.mp4", from: 29.0, to: 30.6, rate: 0.3, box: APPROVAL, zoomFrom: TERM, label: CLI, enter: "zoom", marks: [
      { box: [72, 642, 1056, 112], card: 1 },
      { box: [72, 680, 480, 40], card: 2, note: "to whom" },
      { box: [72, 752, 440, 40], card: 3, note: "what Obol checked" },
    ] },
  ] },
  { audio: 5, next: { kind: "slab", label: "The attack", tone: "magenta" }, segs: [
    { src: "stripe_pay.webm", from: 13.0, to: 17.0, rate: 2, label: "Stripe hosted invoice page · test card 4242" },
    { src: "attack.mp4", from: 9.2, to: 12.8, box: [20, 300, 1500, 360], zoomFrom: TERM, label: CLI, enter: "whip" },
    { src: "dashboard_flip.webm", from: 26.9, to: 29.0, box: TABLE_TOP, zoomFrom: FULL, label: "Obol dashboard in Hermes", enter: "whip" },
  ] },
  { audio: 6, next: { kind: "slab", label: "Obol Guard", tone: "ink" }, segs: [
    { src: "attack.mp4", from: 12.0, to: 16.3, rate: 1.8, box: TERM, label: CLI },
    { src: "attack.mp4", from: 16.3, to: 37.3, rate: 9.5, box: TERM, label: CLI, enter: "zoom" },
    { src: "attack.mp4", from: 37.8, to: 41.4, box: [20, 130, 1880, 520], zoomFrom: TERM, label: CLI, enter: "zoom", marks: [
      { box: [44, 540, 1832, 72], card: 2, note: "lookalike" },
      { box: [44, 362, 1832, 76], card: 3, note: "injected instructions" },
    ] },
    { src: "attack.mp4", from: 45.0, to: 49.9, rate: 1.4, box: [40, 130, 1130, 690], zoomFrom: TERM, label: CLI, enter: "zoom", stampAt: 48.7, marks: [
      { box: [72, 604, 1066, 192], card: 4 },
    ] },
    { src: "views.webm", from: 9.6, to: 10.65, box: SEC_TOP, label: "Obol dashboard · Security", enter: "whip" },
  ] },
  { audio: 7, next: { kind: "whip", dir: 1 }, segs: [
    { src: "guard.mp4", from: 6.0, to: 14.6, rate: 4, box: TERM, label: WALLET },
    { src: "guard.mp4", from: 15.0, to: 19.7, rate: 0.85, box: APPROVAL, zoomFrom: TERM, label: WALLET, enter: "zoom", stampAt: 18.55, marks: [
      { box: [72, 642, 1040, 76], card: 1 },
      { box: [72, 752, 860, 40], card: 2, note: "hidden instruction" },
    ] },
  ] },
  { audio: 8, next: { kind: "slab", tone: "paper" }, segs: [
    { src: "guard.mp4", from: 20.4, to: 25.2, rate: 0.75, box: [20, 300, 1400, 520], zoomFrom: TERM, label: CLI, marks: [
      { box: [50, 434, 1236, 36], card: 0 },
      { box: [50, 364, 200, 36], card: 1, note: "one command" },
    ] }] },
  { audio: 9, segs: [], close: true },
];

type Cap = { text: string; start: number; end: number };
const CAPS = captions as { beat: string; duration: number | null; cards: Cap[] }[];
const LEAD = 0.3;    // narration starts this far into each beat
const TAIL = 0.5;    // and the beat holds this long after it ends (room for the next transition)
const fr = (sec: number) => Math.round(sec * FPS);
const INNER = 7;                                   // frames of a cut between segments
const outerLen = (t?: Outer) => !t ? 0 : t.kind === "slab" ? (t.label ? 24 : 18) : t.kind === "whip" ? 12 : 10;

/* Frame plan: each segment's length and start inside its beat, and each beat's length. */
type Plan = { segFrames: number[]; segStarts: number[]; frames: number };
const plan = (b: Beat): Plan => {
  const need = fr((CAPS[b.audio - 1].duration ?? 6) + LEAD + TAIL);
  if (b.close || !b.segs.length) return { segFrames: [], segStarts: [], frames: need };
  const segFrames = b.segs.map((s) => fr((s.to - s.from) / (s.rate ?? 1)));
  const segStarts: number[] = [];
  let at = 0;
  segFrames.forEach((d, i) => { segStarts.push(at); at += d - (b.segs[i + 1]?.enter ? INNER : 0); });
  if (at < need) segFrames[segFrames.length - 1] += need - at;   // hold the last shot until the narration ends
  return { segFrames, segStarts, frames: Math.max(at, need) };
};
const PLANS = BEATS.map(plan);
export const DEMO_FRAMES = PLANS.reduce((a, p) => a + p.frames, 0) - BEATS.reduce((a, b) => a + outerLen(b.next), 0);
export const DEMO_SECONDS = DEMO_FRAMES / FPS;

/* ---------- transitions ---------- */

type SlabProps = { label?: string; tone: "ink" | "magenta" | "paper"; vertical: boolean };
const Slab: React.FC<TransitionPresentationComponentProps<SlabProps>> = ({ children, presentationDirection, presentationProgress: p, passedProps }) => {
  // Cover (0 → 0.4), hold with the chapter label (0.4 → 0.6), reveal (0.6 → 1).
  if (presentationDirection === "exiting") return <AbsoluteFill>{children}</AbsoluteFill>;
  const cover = interpolate(p, [0, 0.4], [0, 1], { extrapolateRight: "clamp", easing: Easing.bezier(0.7, 0, 0.3, 1) });
  const reveal = interpolate(p, [0.6, 1], [0, 1], { extrapolateLeft: "clamp", easing: Easing.bezier(0.7, 0, 0.3, 1) });
  const main = passedProps.tone === "magenta" ? C.magenta : passedProps.tone === "paper" ? C.paper : C.ink;
  const under = passedProps.tone === "paper" ? C.ink : passedProps.tone === "magenta" ? C.ink : C.magenta;
  const text = passedProps.tone === "paper" ? C.ink : "#fbf8f2";
  // The slab is a skewed band, wider than the frame, that slides in from the left and leaves to the right.
  const x = (-130 + cover * 115 + reveal * 130) + "%";
  const lag = (-120 + cover * 105 + reveal * 125) + "%";   // leads on the way in, trails on the way out
  const labelIn = interpolate(p, [0.3, 0.42], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const labelOut = interpolate(p, [0.58, 0.66], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: p >= 0.5 ? 1 : 0 }}>{children}</AbsoluteFill>
      <AbsoluteFill style={{ transform: `translateX(${lag}) skewX(-14deg)`, background: under, width: "130%" }} />
      <AbsoluteFill style={{ transform: `translateX(${x}) skewX(-14deg)`, background: main, width: "130%" }} />
      {passedProps.label ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: labelIn * labelOut }}>
          <div style={{ fontFamily: F.grot, fontWeight: 900, fontSize: passedProps.vertical ? 120 : 150, letterSpacing: "-0.04em",
            textTransform: "uppercase", color: text, transform: `translateX(${(1 - labelIn) * -60 + (1 - labelOut) * 60}px)` }}>
            {passedProps.label}.
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
const slab = (props: SlabProps): TransitionPresentation<SlabProps> => ({ component: Slab, props });

type WhipProps = { dir: 1 | -1 };
const Whip: React.FC<TransitionPresentationComponentProps<WhipProps>> = ({ children, presentationDirection, presentationProgress: p, passedProps }) => {
  const e = Easing.bezier(0.65, 0, 0.35, 1)(p);
  const off = presentationDirection === "exiting" ? -e * 100 : (1 - e) * 100;
  const blur = Math.sin(Math.PI * p) * 22;
  return <AbsoluteFill style={{ transform: `translateX(${off * passedProps.dir}%)`, filter: `blur(${blur}px)` }}>{children}</AbsoluteFill>;
};
const whip = (dir: 1 | -1): TransitionPresentation<WhipProps> => ({ component: Whip, props: { dir } });

type FlashProps = { strength: number };
const Flash: React.FC<TransitionPresentationComponentProps<FlashProps>> = ({ children, presentationDirection, presentationProgress: p, passedProps }) => {
  const exiting = presentationDirection === "exiting";
  const s = exiting ? 1 + p * 0.25 * passedProps.strength : 1 + (1 - p) * -0.12 * passedProps.strength;
  const op = exiting ? 1 - p : p;
  const glow = Math.max(0, 1 - Math.abs(p - 0.5) * 2.6) * 0.85 * passedProps.strength;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${s})`, opacity: op, filter: `blur(${Math.sin(Math.PI * p) * 8 * passedProps.strength}px)` }}>{children}</AbsoluteFill>
      {!exiting ? <AbsoluteFill style={{ background: "#fbf8f2", opacity: glow, mixBlendMode: "screen" }} /> : null}
    </AbsoluteFill>
  );
};
const flash = (strength = 1): TransitionPresentation<FlashProps> => ({ component: Flash, props: { strength } });

const outerPresentation = (t: Outer, vertical: boolean) =>
  t.kind === "slab" ? slab({ label: t.label, tone: t.tone ?? "ink", vertical }) : t.kind === "whip" ? whip(t.dir) : flash(1);

/* ---------- shots ---------- */

const Highlight: React.FC<{ mark: Mark; since: number; scale: number; vertical: boolean }> = ({ mark, since, scale, vertical }) => {
  // `since`: seconds since this mark's caption card started (negative = not yet).
  if (since < 0) return null;
  const [x, y, w, h] = mark.box;
  const beside = !vertical && x + w + 18 < 1500;   // otherwise the note sits above the box
  const draw = interpolate(since, [0, 0.45], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const per = 2 * (w + h);
  const sw = 5 / Math.max(0.6, scale) * 1.4;
  const noteIn = interpolate(since, [0.25, 0.5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <>
      <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={1920} height={1080}>
        <rect x={x - 8} y={y - 6} width={w + 16} height={h + 12} rx={10} fill={`rgba(222,63,135,${0.12 * draw})`}
          stroke={C.magenta} strokeWidth={sw} strokeDasharray={per + 80} strokeDashoffset={(1 - draw) * (per + 80)} />
      </svg>
      {mark.note && !vertical ? (   /* the narrow vertical frame has no room beside the box */
        <div style={{ position: "absolute", left: beside ? x + w + 18 : Math.max(x, x + w - 520), top: beside ? y + h / 2 - 30 : y - 74, fontFamily: F.hand, fontWeight: 500,
          fontSize: 46 / Math.max(0.6, scale) * 1.2, color: C.magenta, whiteSpace: "nowrap", opacity: noteIn,
          transform: `rotate(-4deg) translateY(${(1 - noteIn) * 10}px)`, textShadow: "0 2px 10px rgba(0,0,0,.6)" }}>{beside ? "← " : "↓ "}{mark.note}</div>
      ) : null}
    </>
  );
};

const Stamp: React.FC<{ since: number; vertical: boolean }> = ({ since, vertical }) => {
  if (since < 0) return null;
  const k = interpolate(since, [0, 0.18], [2.6, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.8)) });
  const op = interpolate(since, [0, 0.08], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: vertical ? "flex-start" : "center", paddingTop: vertical ? 360 : 0 }}>
      <div style={{ transform: `rotate(-9deg) scale(${k})`, opacity: op, padding: "10px 34px 6px", border: `9px solid ${C.stamp}`,
        outline: `3px solid ${C.stamp}`, outlineOffset: 6, color: C.stamp, fontFamily: F.grot, fontWeight: 900, fontSize: vertical ? 130 : 170,
        letterSpacing: "0.06em", background: "rgba(233,227,216,0.92)", boxShadow: "0 18px 50px rgba(0,0,0,.45)" }}>DENIED</div>
    </AbsoluteFill>
  );
};

const ease = Easing.bezier(0.4, 0, 0.2, 1);
const Shot: React.FC<{ seg: Seg; dur: number; start: number; beat: number; vertical: boolean }> = ({ seg, dur, start, beat, vertical }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const areaH = vertical ? height - 330 : seg.box ? height - 170 : height;
  const target = seg.box ?? (vertical ? TERM : FULL);
  const from = seg.zoomFrom ? (vertical && seg.zoomFrom[2] >= 1920 ? TERM : seg.zoomFrom) : target;
  // Spring into the framed region (a touch of overshoot), then a slow push so no shot sits still.
  const p = seg.zoomFrom ? spring({ frame, fps, config: { damping: 15, stiffness: 120, mass: 0.9 }, durationInFrames: fr(1.1) }) : 1;
  const b = from.map((v, i) => v + (target[i] - v) * p) as Box;
  const drift = 1 + 0.035 * interpolate(frame, [0, Math.max(1, dur)], [0, 1], { easing: ease });
  const s = Math.min(width / b[2], areaH / b[3]) * drift;
  const tx = width / 2 - (b[0] + b[2] / 2) * s;
  const ty = areaH / 2 - (b[1] + b[3] / 2) * s;
  const rate = seg.rate ?? 1;
  const srcNow = seg.from + (frame / fps) * rate;
  const beatT = (start + frame) / fps - LEAD;                   // seconds into the narration of this beat
  const cards = CAPS[beat - 1].cards;
  const stampSince = seg.stampAt != null ? (srcNow - seg.stampAt) / rate : -1;
  const shake = stampSince >= 0 && stampSince < 0.25 ? Math.sin(stampSince * 90) * (1 - stampSince / 0.25) * 10 : 0;
  const fast = rate >= 1.5;
  const chip = spring({ frame, fps, config: { damping: 12 }, durationInFrames: 12 });
  return (
    <AbsoluteFill style={{ background: "#0b0b0b", overflow: "hidden", transform: `translate(${shake}px, ${shake * 0.6}px)` }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0",
        transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
        <OffthreadVideo src={staticFile(`captures/${seg.src}`)} startFrom={fr(seg.from)} playbackRate={rate} muted style={{ width: 1920, height: 1080 }} />
        {(seg.marks ?? []).map((m, i) => <Highlight key={i} mark={m} since={beatT - (cards[m.card]?.start ?? 1e9)} scale={s} vertical={vertical} />)}
      </div>
      {seg.dim ? <AbsoluteFill style={{ background: `rgba(0,0,0,${seg.dim})` }} /> : null}
      <Stamp since={stampSince} vertical={vertical} />
      <div style={{ position: "absolute", top: 28, left: 32, display: "flex", gap: 10, fontFamily: F.mono, fontSize: vertical ? 24 : 22,
        transform: `translateY(${(1 - chip) * -20}px)`, opacity: chip }}>
        {seg.label ? <span style={{ background: "rgba(16,14,12,.78)", color: "#e8e6e1", padding: "6px 12px", borderRadius: 6 }}>{seg.label}</span> : null}
        {fast ? <span style={{ background: C.magenta, color: "#fff", padding: "6px 12px", borderRadius: 6, fontWeight: 700 }}>▸▸ {rate}×</span> : null}
      </div>
    </AbsoluteFill>
  );
};

/* ---------- captions, close, assembly ---------- */

const Captions: React.FC<{ beat: number; vertical: boolean }> = ({ beat, vertical }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS - LEAD;
  const card = CAPS[beat - 1]?.cards.find((c) => t >= c.start && t < c.end + 0.15);
  if (!card) return null;
  const k = interpolate(t - card.start, [0, 0.16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: vertical ? 90 : 64, display: "flex", justifyContent: "center", padding: "0 40px",
      opacity: Math.min(1, k * 1.5), transform: `translateY(${(1 - k) * 18}px) scale(${0.94 + 0.06 * k})` }}>
      <div style={{ maxWidth: vertical ? 980 : 1500, padding: "16px 30px 18px", borderRadius: 14, background: "rgba(16,14,12,0.86)",
        color: "#fbf8f2", fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 58 : 60, lineHeight: 1.12,
        letterSpacing: "-0.015em", textAlign: "center", boxShadow: "0 10px 30px rgba(0,0,0,.35)" }}>{card.text}</div>
    </div>
  );
};

const Close: React.FC<{ vertical: boolean }> = ({ vertical }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const up = (delay: number) => spring({ frame: frame - delay, fps, config: { damping: 14, mass: 0.8 } });
  const stamp = interpolate(frame, [22, 34], [2.4, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) });
  const letters = "OBOL.".split("");
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "left", marginTop: vertical ? -260 : -120, padding: "0 60px" }}>
        <div style={{ display: "inline-block", padding: "8px 16px 6px", border: `4px solid ${C.magenta}`, outline: `2px solid ${C.magenta}`,
          outlineOffset: 3, color: C.magenta, fontFamily: F.grot, fontWeight: 900, fontSize: 26, letterSpacing: "0.12em",
          transform: `rotate(-2deg) scale(${stamp})`, opacity: frame > 21 ? 1 : 0 }}>SECURITY-FIRST INVOICING</div>
        <div style={{ display: "flex", fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 190 : 210, lineHeight: 0.9, letterSpacing: "-0.05em", color: C.ink, marginTop: 24 }}>
          {letters.map((l, i) => {
            const k = up(2 + i * 3);
            return <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - k) * 120}px)`, opacity: Math.min(1, k * 1.4) }}>{l}</span>;
          })}
        </div>
        <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 38 : 44, color: C.ink, marginTop: 22, letterSpacing: "-0.01em",
          textTransform: "uppercase", maxWidth: 960, opacity: up(18), transform: `translateY(${(1 - up(18)) * 30}px)` }}>
          A Hermes Agent plugin · in the Hermes Marketplace
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 30, color: C.inkSoft, marginTop: 14, opacity: up(26), transform: `translateY(${(1 - up(26)) * 20}px)` }}>
          hermes plugins install ueddy/obol
        </div>
      </div>
    </AbsoluteFill>
  );
};

const innerPresentation = (kind: Inner) => (kind === "whip" ? whip(-1) : flash(0.6));

const BeatView: React.FC<{ beat: Beat; plan: Plan; vertical: boolean }> = ({ beat, plan: pl, vertical }) => (
  <AbsoluteFill style={{ background: "#0b0b0b" }}>
    {beat.close ? <Close vertical={vertical} /> : (
      <TransitionSeries>
        {beat.segs.flatMap((seg, i) => {
          const items = [];
          if (i > 0 && seg.enter) items.push(
            <TransitionSeries.Transition key={`t${i}`} presentation={innerPresentation(seg.enter)} timing={linearTiming({ durationInFrames: INNER })} />);
          items.push(
            <TransitionSeries.Sequence key={`s${i}`} durationInFrames={pl.segFrames[i]}>
              <Shot seg={seg} dur={pl.segFrames[i]} start={pl.segStarts[i]} beat={beat.audio} vertical={vertical} />
            </TransitionSeries.Sequence>);
          return items;
        })}
      </TransitionSeries>
    )}
    <Sequence from={fr(LEAD)}><Audio src={staticFile(`audio/beat${beat.audio}.mp3`)} /></Sequence>
    <Captions beat={beat.audio} vertical={vertical} />
  </AbsoluteFill>
);

export const Demo: React.FC<{ vertical?: boolean }> = ({ vertical = false }) => (
  <AbsoluteFill style={{ background: "#0b0b0b" }}>
    <TransitionSeries>
      {BEATS.flatMap((b, i) => {
        const items = [
          <TransitionSeries.Sequence key={`b${i}`} durationInFrames={PLANS[i].frames}>
            <BeatView beat={b} plan={PLANS[i]} vertical={vertical} />
          </TransitionSeries.Sequence>,
        ];
        if (b.next) items.push(
          <TransitionSeries.Transition key={`x${i}`} presentation={outerPresentation(b.next, vertical)} timing={linearTiming({ durationInFrames: outerLen(b.next) })} />);
        return items;
      })}
    </TransitionSeries>
  </AbsoluteFill>
);
