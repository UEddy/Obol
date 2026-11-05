import React from "react";
import {
  AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";
import captions from "../captions.json";
import views from "../public/captures/views.json";
import { C, F, FPS } from "./theme";

/*
 * The Obol demo: nine beats, each as long as its narration clip (public/audio/beatN.mp3, timed in
 * captions.json) plus a short tail. Every shot is real footage from demo/capture: VHS recordings of the
 * Hermes CLI (trigger, attack, guard), and Playwright recordings of Stripe's hosted invoice page and the
 * Obol dashboard. Segments only choose a time range, a playback rate and a region to frame; sped-up
 * stretches are labelled with their rate.
 */

type Box = [number, number, number, number]; // x, y, w, h in the 1920x1080 source
type Seg = {
  src: string; from: number; to: number; rate?: number;
  box?: Box;            // region to frame (whole frame when omitted)
  zoomFrom?: Box;       // animate from this region to `box` over the segment's first second
  label?: string; dim?: number;
};
type Beat = { audio: number; segs: Seg[]; close?: boolean };

const TERM: Box = [20, 0, 1320, 1080];       // where the CLI text lives (left part of the terminal)
const FULL: Box = [0, 0, 1920, 1080];
const APPROVAL: Box = [40, 290, 1130, 530];   // Hermes approval box in the 26px-font tapes
const o = views.overdue;
const OVERDUE: Box = [o.x - 40, o.y - 30, o.width + 80, o.height + 60];
const TABLE_TOP: Box = [290, 470, 1570, 360];
const SEC_TOP: Box = [290, 100, 1570, 620];

const CLI = "Hermes CLI · Stripe test mode";
const BEATS: Beat[] = [
  { audio: 1, segs: [{ src: "views.webm", from: 3.6, to: 9.4, dim: 0.55, box: [60, 20, 1800, 1013], zoomFrom: FULL, label: "Obol dashboard in Hermes" }] },
  { audio: 2, segs: [{ src: "views.webm", from: 3.6, to: 9.3, rate: 0.95, box: OVERDUE, zoomFrom: FULL, label: "Obol dashboard in Hermes" }] },
  { audio: 3, segs: [
    { src: "trigger.mp4", from: 0, to: 3.6, rate: 1.4, box: TERM, label: CLI },
    { src: "trigger.mp4", from: 3.6, to: 21.5, rate: 9, box: TERM, label: CLI },
    { src: "trigger.mp4", from: 21.5, to: 24.4, box: [20, 0, 1300, 560], zoomFrom: TERM, label: CLI },
  ] },
  { audio: 4, segs: [
    { src: "trigger.mp4", from: 25.8, to: 29.0, rate: 1.6, box: TERM, label: CLI },
    { src: "trigger.mp4", from: 29.0, to: 30.5, rate: 0.3, box: APPROVAL, zoomFrom: TERM, label: CLI },
    { src: "trigger.mp4", from: 30.5, to: 31.0, box: APPROVAL, label: CLI },
  ] },
  { audio: 5, segs: [
    { src: "stripe_pay.webm", from: 13.0, to: 17.0, rate: 2, label: "Stripe hosted invoice page · test card 4242" },
    { src: "attack.mp4", from: 9.2, to: 12.8, box: [20, 300, 1500, 360], zoomFrom: TERM, label: CLI },
    { src: "dashboard_flip.webm", from: 26.9, to: 29.0, box: TABLE_TOP, zoomFrom: FULL, label: "Obol dashboard in Hermes" },
  ] },
  { audio: 6, segs: [
    { src: "attack.mp4", from: 12.0, to: 16.3, rate: 1.8, box: TERM, label: CLI },
    { src: "attack.mp4", from: 16.3, to: 37.3, rate: 9.5, box: TERM, label: CLI },
    { src: "attack.mp4", from: 37.4, to: 40.7, box: [20, 0, 1500, 620], zoomFrom: TERM, label: CLI },
    { src: "attack.mp4", from: 45.0, to: 48.6, rate: 1.33, box: [40, 130, 1130, 690], zoomFrom: TERM, label: CLI },
    { src: "views.webm", from: 9.6, to: 10.65, box: SEC_TOP, label: "Obol dashboard · Security" },
  ] },
  { audio: 7, segs: [
    { src: "guard.mp4", from: 6.0, to: 14.6, rate: 4, box: TERM, label: CLI + " · wallet plugin: agentwalletapi" },
    { src: "guard.mp4", from: 15.0, to: 18.4, rate: 0.85, box: APPROVAL, zoomFrom: TERM, label: CLI + " · wallet plugin: agentwalletapi" },
  ] },
  { audio: 8, segs: [{ src: "guard.mp4", from: 20.4, to: 25.2, rate: 0.75, box: [20, 300, 1400, 520], zoomFrom: TERM, label: CLI }] },
  { audio: 9, segs: [], close: true },
];

type Cap = { text: string; start: number; end: number };
const CAPS = captions as { beat: string; duration: number | null; cards: Cap[] }[];
const LEAD = 0.15;   // narration starts this far into each beat
const TAIL = 0.45;   // and the picture holds this long after it ends
const segLen = (s: Seg) => (s.to - s.from) / (s.rate ?? 1);
export const beatLen = (b: Beat) =>
  b.close || !b.segs.length ? (CAPS[b.audio - 1].duration ?? 6) + LEAD + TAIL : b.segs.reduce((a, s) => a + segLen(s), 0);
const fr = (sec: number) => Math.round(sec * FPS);
export const DEMO_SECONDS = BEATS.reduce((a, b) => a + beatLen(b), 0);

const ease = Easing.bezier(0.4, 0, 0.2, 1);

const Shot: React.FC<{ seg: Seg; dur: number; vertical: boolean }> = ({ seg, dur, vertical }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  // Framed shots sit above the caption band so captions never cover what the narration points at.
  const areaH = vertical ? height - 330 : seg.box ? height - 170 : height;
  const target = seg.box ?? (vertical ? TERM : FULL);
  const start = seg.zoomFrom ? (vertical && seg.zoomFrom === FULL ? TERM : seg.zoomFrom) : target;
  const p = interpolate(frame, [0, Math.min(dur, fr(1.0))], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const b = start.map((v, i) => v + (target[i] - v) * p) as Box;
  const s = Math.min(width / b[2], areaH / b[3]);
  const tx = width / 2 - (b[0] + b[2] / 2) * s;
  const ty = areaH / 2 - (b[1] + b[3] / 2) * s;
  const fast = (seg.rate ?? 1) >= 1.5;
  return (
    <AbsoluteFill style={{ background: "#0b0b0b", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0",
        transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
        <OffthreadVideo src={staticFile(`captures/${seg.src}`)} startFrom={fr(seg.from)} playbackRate={seg.rate ?? 1} muted
          style={{ width: 1920, height: 1080 }} />
      </div>
      {seg.dim ? <AbsoluteFill style={{ background: `rgba(0,0,0,${seg.dim})` }} /> : null}
      <div style={{ position: "absolute", top: 28, left: 32, display: "flex", gap: 10, fontFamily: F.mono, fontSize: vertical ? 24 : 22 }}>
        {seg.label ? <span style={{ background: "rgba(16,14,12,.78)", color: "#e8e6e1", padding: "6px 12px", borderRadius: 6 }}>{seg.label}</span> : null}
        {fast ? <span style={{ background: C.magenta, color: "#fff", padding: "6px 12px", borderRadius: 6, fontWeight: 700 }}>▸▸ {seg.rate}×</span> : null}
      </div>
    </AbsoluteFill>
  );
};

const Captions: React.FC<{ beat: number; vertical: boolean }> = ({ beat, vertical }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS - LEAD;
  const card = CAPS[beat - 1]?.cards.find((c) => t >= c.start && t < c.end + 0.15);
  if (!card) return null;
  const fadeIn = interpolate(t - card.start, [0, 0.12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: vertical ? 90 : 64, display: "flex", justifyContent: "center", opacity: fadeIn, padding: "0 40px" }}>
      <div style={{ maxWidth: vertical ? 980 : 1500, padding: "16px 30px 18px", borderRadius: 14, background: "rgba(16,14,12,0.86)",
        color: "#fbf8f2", fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 58 : 60, lineHeight: 1.12,
        letterSpacing: "-0.015em", textAlign: "center", boxShadow: "0 10px 30px rgba(0,0,0,.35)" }}>{card.text}</div>
    </div>
  );
};

const Close: React.FC<{ vertical: boolean }> = ({ vertical }) => {
  const frame = useCurrentFrame();
  const op = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const stamp = interpolate(frame, [18, 30], [2.2, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) });
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: "center", justifyContent: "center", opacity: op }}>
      <div style={{ textAlign: "left", marginTop: vertical ? -260 : -120, padding: "0 60px" }}>
        <div style={{ display: "inline-block", padding: "8px 16px 6px", border: `4px solid ${C.magenta}`, outline: `2px solid ${C.magenta}`,
          outlineOffset: 3, color: C.magenta, fontFamily: F.grot, fontWeight: 900, fontSize: 26, letterSpacing: "0.12em",
          transform: `rotate(-2deg) scale(${stamp})`, opacity: frame > 17 ? 1 : 0 }}>SECURITY-FIRST INVOICING</div>
        <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 190 : 210, lineHeight: 0.9, letterSpacing: "-0.05em", color: C.ink, marginTop: 24 }}>OBOL.</div>
        <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 38 : 44, color: C.ink, marginTop: 22, letterSpacing: "-0.01em", textTransform: "uppercase", maxWidth: 960 }}>
          A Hermes Agent plugin · in the Hermes Marketplace
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 30, color: C.inkSoft, marginTop: 14 }}>hermes plugins install ueddy/obol</div>
      </div>
    </AbsoluteFill>
  );
};

const BeatView: React.FC<{ beat: Beat; vertical: boolean }> = ({ beat, vertical }) => {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: "#0b0b0b" }}>
      {beat.close ? <Close vertical={vertical} /> : beat.segs.map((seg, i) => {
        const d = fr(segLen(seg)); const from = fr(at); at += segLen(seg);
        return <Sequence key={i} from={from} durationInFrames={d}><Shot seg={seg} dur={d} vertical={vertical} /></Sequence>;
      })}
      <Sequence from={fr(LEAD)}><Audio src={staticFile(`audio/beat${beat.audio}.mp3`)} /></Sequence>
      <Captions beat={beat.audio} vertical={vertical} />
    </AbsoluteFill>
  );
};

export const Demo: React.FC<{ vertical?: boolean }> = ({ vertical = false }) => {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: "#0b0b0b" }}>
      {BEATS.map((b, i) => {
        const from = fr(at); const d = fr(beatLen(b)); at += beatLen(b);
        return <Sequence key={i} from={from} durationInFrames={d}><BeatView beat={b} vertical={vertical} /></Sequence>;
      })}
    </AbsoluteFill>
  );
};
