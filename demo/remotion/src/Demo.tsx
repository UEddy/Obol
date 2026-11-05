import React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";
import captions from "../captions.json";
import { C, F, FPS } from "./theme";

/*
 * The Obol demo, in six scenes: what it is, send an invoice, get paid, stop a scam, see everything, close.
 * Every shot is real footage from demo/capture (VHS recordings of the Hermes CLI in a narrow, large-type
 * terminal; Chrome screencasts of Stripe's hosted invoice page on a phone-sized viewport). Each shot frames
 * the two or three lines that matter, so text stays readable on a phone. Each caption card plays its own slice
 * of the voiceover (public/audio/sceneN.mp3, timed in captions.json) at the moment its action is on screen.
 */

type Box = [number, number, number, number];            // x, y, w, h in the source video's pixels
type Mark = { box: Box; at: number };                    // highlight, `at` seconds into the shot
type Shot = { src: string; from: number; to: number; rate?: number; box: Box; marks?: Mark[]; stampAt?: number; label: string };
type Scene = { audio: number; cues: number[]; shots: Shot[]; card?: "logo" | "close"; len?: number; label?: string };

const SIZE: Record<string, [number, number]> = {
  "send_and_paid.mp4": [1240, 2000], "have_they_paid.mp4": [1240, 2000], "scam.mp4": [1240, 2000],
  "stripe_pay.mp4": [1170, 2532], "stripe_paid.mp4": [1170, 2532],
};
const CLI = "Hermes · Stripe test mode";
const PAGE = "Stripe payment page · test card";

const SCENES: Scene[] = [
  { audio: 1, card: "logo", len: 6.3, cues: [0.35, 2.93], shots: [] },
  { audio: 2, label: "Send an invoice", cues: [0.4, 5.1, 9.4], shots: [
    { src: "send_and_paid.mp4", from: 4.2, to: 9.2, box: [30, 200, 1190, 300], label: CLI },                       // the forwarded message
    { src: "send_and_paid.mp4", from: 17.6, to: 22.0, box: [30, 545, 1190, 225], label: CLI,
      marks: [{ box: [32, 700, 560, 56], at: 1.2 }] },                                                               // Total: $1,800.00
    { src: "send_and_paid.mp4", from: 23.0, to: 24.6, rate: 0.3, box: [70, 1060, 1060, 580], label: CLI,
      marks: [{ box: [84, 1088, 330, 52], at: 0.6 }, { box: [84, 1572, 560, 54], at: 2.4 }] },                     // Allow once · Risk checks
    { src: "send_and_paid.mp4", from: 27.4, to: 31.0, box: [30, 975, 1190, 280], label: CLI,
      marks: [{ box: [32, 1026, 150, 54], at: 0.4 }] },                                                              // Sent.
  ] },
  { audio: 3, label: "Get paid", cues: [0.4, 6.6], shots: [
    { src: "stripe_pay.mp4", from: 0.0, to: 1.9, rate: 0.8, box: [40, 470, 1100, 420], label: PAGE },
    { src: "stripe_pay.mp4", from: 2.9, to: 3.7, rate: 0.4, box: [60, 1640, 1100, 460], label: PAGE,
      marks: [{ box: [110, 1755, 1050, 105], at: 0.8 }] },
    { src: "stripe_paid.mp4", from: 0, to: 2.6, box: [150, 690, 870, 520], label: PAGE,
      marks: [{ box: [300, 945, 590, 230], at: 0.3 }] },
    { src: "have_they_paid.mp4", from: 1.7, to: 4.2, rate: 0.7, box: [30, 1075, 1190, 545], label: CLI,
      marks: [{ box: [32, 1352, 330, 58], at: 0.5 }] },
  ] },
  { audio: 4, label: "Stop a scam", cues: [0.4, 5.2], shots: [
    { src: "scam.mp4", from: 6.0, to: 11.0, box: [30, 205, 1195, 395], label: CLI,
      marks: [{ box: [36, 212, 1180, 112], at: 0.9 }, { box: [36, 432, 1180, 165], at: 2.2 }] },                 // fake address · skip approval
    { src: "scam.mp4", from: 25.7, to: 26.8, rate: 0.3, box: [20, 270, 1200, 530], label: CLI,
      marks: [{ box: [26, 280, 1188, 60], at: 0.3 }, { box: [26, 556, 1188, 130], at: 1.3 }, { box: [26, 716, 1188, 74], at: 2.3 }] }, // caught · injection · withheld
    { src: "scam.mp4", from: 29.6, to: 32.6, rate: 0.5, box: [80, 1240, 1000, 318], label: CLI, stampAt: 31.85,
      marks: [{ box: [86, 1296, 984, 110], at: 0.4 }, { box: [86, 1404, 984, 152], at: 1.6 }] },                 // impersonation · lookalike
  ] },
  { audio: 5, label: "See everything", cues: [0.6], shots: [
    { src: "scam.mp4", from: 37.6, to: 40.3, rate: 0.4, box: [30, 200, 760, 345], label: CLI,
      marks: [{ box: [36, 372, 720, 172], at: 1.0 }] },
  ] },
  { audio: 6, card: "close", len: 5.6, cues: [0.35], shots: [] },
];

type Card = { text: string; start: number; end: number };
const CAPS = captions as { beat: string; duration: number | null; cards: Card[] }[];
const fr = (sec: number) => Math.round(sec * FPS);
const INNER = 6;        // frames of a cut between shots
const SLAB = 24;        // frames of a chapter wipe between scenes
const shotFrames = (s: Shot) => fr((s.to - s.from) / (s.rate ?? 1));

type Plan = { shotFrames: number[]; shotStarts: number[]; frames: number };
const plan = (sc: Scene, next?: Scene): Plan => {
  const cards = CAPS[sc.audio - 1].cards;
  const lastCue = sc.cues[sc.cues.length - 1] + ((CAPS[sc.audio - 1].duration ?? 0) - cards[cards.length - 1].start);
  const need = fr(lastCue + 0.35) + (next ? SLAB : 0);     // narration finishes before the next wipe starts
  if (sc.card) return { shotFrames: [], shotStarts: [], frames: Math.max(fr(sc.len ?? 5), need) };
  const shotFramesArr = sc.shots.map(shotFrames);
  const shotStarts: number[] = []; let at = 0;
  shotFramesArr.forEach((d, i) => { shotStarts.push(at); at += d - (i < shotFramesArr.length - 1 ? INNER : 0); });
  if (at < need) shotFramesArr[shotFramesArr.length - 1] += need - at;
  return { shotFrames: shotFramesArr, shotStarts, frames: Math.max(at, need) };
};
const PLANS = SCENES.map((s, i) => plan(s, SCENES[i + 1]));
export const DEMO_FRAMES = PLANS.reduce((a, p) => a + p.frames, 0) - SLAB * (SCENES.length - 1);

/* ---------- transitions (no blur: every frame stays sharp) ---------- */

type SlabProps = { label?: string; tone: "ink" | "paper"; vertical: boolean };
const Slab: React.FC<TransitionPresentationComponentProps<SlabProps>> = ({ children, presentationDirection, presentationProgress: p, passedProps }) => {
  if (presentationDirection === "exiting") return <AbsoluteFill>{children}</AbsoluteFill>;
  const cover = interpolate(p, [0, 0.38], [0, 1], { extrapolateRight: "clamp", easing: Easing.bezier(0.7, 0, 0.3, 1) });
  const reveal = interpolate(p, [0.62, 1], [0, 1], { extrapolateLeft: "clamp", easing: Easing.bezier(0.7, 0, 0.3, 1) });
  const main = passedProps.tone === "paper" ? C.paper : C.ink;
  const text = passedProps.tone === "paper" ? C.ink : "#fbf8f2";
  const x = (-130 + cover * 115 + reveal * 130) + "%";
  const lag = (-120 + cover * 105 + reveal * 125) + "%";
  const k = interpolate(p, [0.3, 0.42, 0.58, 0.66], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: p >= 0.5 ? 1 : 0 }}>{children}</AbsoluteFill>
      <AbsoluteFill style={{ transform: `translateX(${lag}) skewX(-14deg)`, background: C.magenta, width: "130%" }} />
      <AbsoluteFill style={{ transform: `translateX(${x}) skewX(-14deg)`, background: main, width: "130%" }} />
      {passedProps.label ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: k }}>
          <div style={{ fontFamily: F.grot, fontWeight: 900, fontSize: passedProps.vertical ? 116 : 150, letterSpacing: "-0.04em", lineHeight: 0.95,
            textTransform: "uppercase", color: text, textAlign: "center", padding: "0 40px", transform: `translateY(${(1 - k) * 24}px)` }}>
            {passedProps.label}.
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};
const slab = (props: SlabProps): TransitionPresentation<SlabProps> => ({ component: Slab, props });

const Punch: React.FC<TransitionPresentationComponentProps<Record<string, never>>> = ({ children, presentationDirection, presentationProgress: p }) => {
  const exiting = presentationDirection === "exiting";
  return <AbsoluteFill style={{ opacity: exiting ? 1 - p : p, transform: `scale(${exiting ? 1 + p * 0.08 : 0.94 + p * 0.06})` }}>{children}</AbsoluteFill>;
};
const punch: TransitionPresentation<Record<string, never>> = { component: Punch, props: {} };

/* ---------- shots ---------- */

/* Dim everything outside the shot's focus box, so cut-off neighbouring lines recede. */
const Focus: React.FC<{ box: Box }> = ({ box: [x, y, w, h] }) => {
  const dim = "rgba(11,11,11,0.8)"; const pad = 14; const big = 4000;
  return (
    <>
      <div style={{ position: "absolute", left: -big, top: -big, width: 3 * big, height: big + y - pad, background: dim }} />
      <div style={{ position: "absolute", left: -big, top: y + h + pad, width: 3 * big, height: big, background: dim }} />
      <div style={{ position: "absolute", left: -big, top: y - pad, width: big + x - pad, height: h + 2 * pad, background: dim }} />
      <div style={{ position: "absolute", left: x + w + pad, top: y - pad, width: big, height: h + 2 * pad, background: dim }} />
    </>
  );
};

const Highlight: React.FC<{ box: Box; since: number; scale: number }> = ({ box: [x, y, w, h], since, scale }) => {
  if (since < 0) return null;
  const draw = interpolate(since, [0, 0.4], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const per = 2 * (w + h) + 80;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={10} height={10}>
      <rect x={x - 6} y={y - 4} width={w + 12} height={h + 8} rx={10} fill={`rgba(222,63,135,${0.13 * draw})`}
        stroke={C.magenta} strokeWidth={6 / scale} strokeDasharray={per} strokeDashoffset={(1 - draw) * per} />
    </svg>
  );
};

const Stamp: React.FC<{ since: number; vertical: boolean }> = ({ since, vertical }) => {
  if (since < 0) return null;
  const k = interpolate(since, [0, 0.18], [2.6, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.8)) });
  const op = interpolate(since, [0, 0.08], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: vertical ? 90 : 70 }}>
      <div style={{ transform: `rotate(-9deg) scale(${k})`, opacity: op, padding: "10px 34px 6px", border: `9px solid ${C.stamp}`,
        outline: `3px solid ${C.stamp}`, outlineOffset: 6, color: C.stamp, fontFamily: F.grot, fontWeight: 900, fontSize: vertical ? 130 : 160,
        letterSpacing: "0.06em", background: "rgba(233,227,216,0.95)", boxShadow: "0 18px 50px rgba(0,0,0,.45)" }}>DENIED</div>
    </AbsoluteFill>
  );
};

const ShotView: React.FC<{ shot: Shot; dur: number; vertical: boolean }> = ({ shot, dur, vertical }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const [sw, sh] = SIZE[shot.src];
  const areaH = height - (vertical ? 300 : 170);           // the caption band stays clear below the picture
  const [bx, by, bw, bh] = shot.box;
  // Punch in from a slightly wider frame of the same lines (never the whole terminal), then drift gently.
  const p = spring({ frame, fps, config: { damping: 16, stiffness: 130, mass: 0.9 }, durationInFrames: fr(0.9) });
  const widen = 1 + 0.22 * (1 - p);
  const drift = 1 + 0.025 * interpolate(frame, [0, Math.max(1, dur)], [0, 1]);
  const s = Math.min(width / (bw * widen), areaH / (bh * widen)) * drift;
  const tx = width / 2 - (bx + bw / 2) * s;
  const ty = areaH / 2 - (by + bh / 2) * s;
  const rate = shot.rate ?? 1;
  const t = frame / fps;                                    // seconds into the shot (output time)
  const stampSince = shot.stampAt != null ? t - (shot.stampAt - shot.from) / rate : -1;
  const shake = stampSince >= 0 && stampSince < 0.25 ? Math.sin(stampSince * 90) * (1 - stampSince / 0.25) * 9 : 0;
  const light = shot.src.startsWith("stripe");
  return (
    <AbsoluteFill style={{ background: light ? "#f6f7f9" : "#0b0b0b", overflow: "hidden", transform: `translate(${shake}px, ${shake * 0.6}px)` }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: sw, height: sh, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
        <OffthreadVideo src={staticFile(`captures/${shot.src}`)} startFrom={fr(shot.from)} playbackRate={rate} muted style={{ width: sw, height: sh }} />
        {light ? null : <Focus box={shot.box} />}
        {(shot.marks ?? []).map((m, i) => <Highlight key={i} box={m.box} since={t - m.at} scale={s} />)}
      </div>
      <AbsoluteFill style={{ top: areaH, background: "#0b0b0b" }} />
      <Stamp since={stampSince} vertical={vertical} />
      <div style={{ position: "absolute", top: 26, left: 30, fontFamily: F.mono, fontSize: vertical ? 26 : 24, background: "rgba(16,14,12,.8)",
        color: "#e8e6e1", padding: "6px 12px", borderRadius: 6 }}>{shot.label}</div>
    </AbsoluteFill>
  );
};

/* ---------- cards ---------- */

const Rise: React.FC<{ delay: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ delay, children, style }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const k = spring({ frame: frame - delay, fps, config: { damping: 14, mass: 0.8 } });
  return <div style={{ ...style, opacity: Math.min(1, k * 1.4), transform: `translateY(${(1 - k) * 40}px)` }}>{children}</div>;
};

const Logo: React.FC<{ vertical: boolean; close?: boolean }> = ({ vertical, close }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const stamp = interpolate(frame, [20, 32], [2.4, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) });
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: "center", justifyContent: "center" }}>
      <div style={{ marginTop: vertical ? -260 : -150, padding: "0 60px", textAlign: "left" }}>
        <div style={{ display: "inline-block", padding: "8px 16px 6px", border: `4px solid ${C.magenta}`, outline: `2px solid ${C.magenta}`, outlineOffset: 3,
          color: C.magenta, fontFamily: F.grot, fontWeight: 900, fontSize: vertical ? 30 : 30, letterSpacing: "0.12em",
          transform: `rotate(-2deg) scale(${stamp})`, opacity: frame > 19 ? 1 : 0 }}>SECURITY-FIRST INVOICING</div>
        <div style={{ display: "flex", fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 230 : 250, lineHeight: 0.9, letterSpacing: "-0.05em", color: C.ink, marginTop: 20 }}>
          {"OBOL.".split("").map((l, i) => {
            const k = spring({ frame: frame - 2 - i * 3, fps, config: { damping: 14, mass: 0.8 } });
            return <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - k) * 120}px)`, opacity: Math.min(1, k * 1.4) }}>{l}</span>;
          })}
        </div>
        <Rise delay={16} style={{ fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 46 : 52, color: C.ink, marginTop: 18, letterSpacing: "-0.01em" }}>
          A plugin for Hermes Agent
        </Rise>
        {close ? (
          <Rise delay={24} style={{ marginTop: 34, display: "inline-block", fontFamily: F.mono, fontWeight: 700, fontSize: vertical ? 42 : 48, color: "#fbf8f2",
            background: C.ink, padding: "16px 26px", borderRadius: 12 }}>hermes plugins install ueddy/obol</Rise>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

/* ---------- captions and voice ---------- */

const SceneVoice: React.FC<{ scene: Scene; frames: number; vertical: boolean }> = ({ scene, frames, vertical }) => {
  const frame = useCurrentFrame();
  const cap = CAPS[scene.audio - 1];
  const t = frame / FPS;
  const i = scene.cues.findIndex((c, k) => t >= c && t < (scene.cues[k + 1] ?? frames / FPS - SLAB / FPS + 0.1));
  const card = i >= 0 ? cap.cards[i] : null;
  const k = card ? interpolate(t - scene.cues[i], [0, 0.16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) }) : 0;
  return (
    <>
      {cap.cards.map((c, j) => {
        const end = cap.cards[j + 1]?.start ?? cap.duration ?? c.end;
        return (
          <Sequence key={j} from={fr(scene.cues[j])} durationInFrames={Math.max(1, fr(end - c.start) + 2)}>
            <Audio src={staticFile(`audio/scene${scene.audio}.mp3`)} startFrom={fr(c.start)} endAt={fr(end) + 2}
              volume={(f) => interpolate(f, [0, 2], [0, 1], { extrapolateRight: "clamp" })} />
          </Sequence>
        );
      })}
      {card ? (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: vertical ? 70 : 34, display: "flex", justifyContent: "center", padding: "0 36px",
          opacity: Math.min(1, k * 1.5), transform: `translateY(${(1 - k) * 14}px)` }}>
          <div style={{ maxWidth: vertical ? 1000 : 1700, padding: "14px 30px 16px", borderRadius: 14, background: "rgba(16,14,12,0.9)", color: "#fbf8f2",
            fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 62 : 64, lineHeight: 1.1, letterSpacing: "-0.015em", textAlign: "center" }}>{card.text}</div>
        </div>
      ) : null}
    </>
  );
};

const SceneView: React.FC<{ scene: Scene; plan: Plan; vertical: boolean }> = ({ scene, plan: pl, vertical }) => (
  <AbsoluteFill style={{ background: "#0b0b0b" }}>
    {scene.card ? <Logo vertical={vertical} close={scene.card === "close"} /> : (
      <TransitionSeries>
        {scene.shots.flatMap((shot, i) => {
          const items = [];
          if (i > 0) items.push(<TransitionSeries.Transition key={`t${i}`} presentation={punch} timing={linearTiming({ durationInFrames: INNER })} />);
          items.push(<TransitionSeries.Sequence key={`s${i}`} durationInFrames={pl.shotFrames[i]}><ShotView shot={shot} dur={pl.shotFrames[i]} vertical={vertical} /></TransitionSeries.Sequence>);
          return items;
        })}
      </TransitionSeries>
    )}
    <SceneVoice scene={scene} frames={pl.frames} vertical={vertical} />
  </AbsoluteFill>
);

export const Demo: React.FC<{ vertical?: boolean }> = ({ vertical = false }) => (
  <AbsoluteFill style={{ background: "#0b0b0b" }}>
    <TransitionSeries>
      {SCENES.flatMap((sc, i) => {
        const items = [<TransitionSeries.Sequence key={`c${i}`} durationInFrames={PLANS[i].frames}><SceneView scene={sc} plan={PLANS[i]} vertical={vertical} /></TransitionSeries.Sequence>];
        const next = SCENES[i + 1];
        if (next) items.push(<TransitionSeries.Transition key={`x${i}`} timing={linearTiming({ durationInFrames: SLAB })}
          presentation={slab({ label: next.label, tone: next.card ? "paper" : "ink", vertical })} />);
        return items;
      })}
    </TransitionSeries>
  </AbsoluteFill>
);
