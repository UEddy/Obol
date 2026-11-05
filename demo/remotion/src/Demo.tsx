import React from "react";
import {
  AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";
import captions from "../captions.json";
import { C, F, FPS } from "./theme";

/*
 * The Obol demo, in seven scenes: what it is, send an invoice (live Telegram), get paid, works anywhere,
 * stop a scam, see everything, close. Every shot is real footage from demo/capture: Telegram Web driving
 * Hermes's real Telegram gateway, Chrome screencasts of the card payment page, VHS recordings of the
 * Hermes CLI, and the Obol dashboard. Each shot frames the few lines that matter, so text reads on a phone.
 *
 * Look: a paper desk. Footage arrives on cards dealt onto the desk, scenes change with a page curl, and the
 * Obol card flips over. Each scene lasts at least as long as its line of voiceover (public/audio/sceneN.mp3,
 * timed in captions.json), so a new take drops in without touching the cut.
 */

type Box = [number, number, number, number];            // x, y, w, h in the source's pixels
type Mark = { box: Box; at: number };                    // highlight drawn `at` seconds into the shot
type Shot = { card: number; src: string; from?: number; len?: number; rate?: number; box: Box; marks?: Mark[];
  stampAt?: number; label: string; tilt?: number };
type Scene = { audio: number; shots: Shot[]; kind?: "intro" | "logos" | "close" };

const SIZE: Record<string, [number, number]> = {
  "telegram.mp4": [1170, 2532], "stripe_pay.mp4": [1170, 2532], "stripe_paid.mp4": [1170, 2532],
  "scam.mp4": [1240, 2000], "dashboard-security.png": [3200, 2000], "dashboard-invoices.png": [3200, 2000],
};
const TG = "Telegram · Hermes gateway · live";
const PAY = "Card payment page · test card";
const CLI = "Hermes terminal";
const DASH = "Obol dashboard · Security";

// Every shot belongs to one caption card (`card`); a card's slice of the voiceover starts as its first shot
// lands, and its shots share exactly that line's length plus a short beat, so picture and voice stay in step.
const SCENES: Scene[] = [
  { audio: 1, kind: "intro", shots: [] },
  { audio: 2, shots: [
    { card: 0, src: "telegram.mp4", from: 8.6, box: [270, 1410, 850, 430], label: TG, tilt: 1.2,
      marks: [{ box: [285, 1430, 820, 390], at: 0.3 }] },                                                              // the forwarded message
    { card: 1, src: "telegram.mp4", from: 44.0, box: [20, 1240, 1010, 600], label: TG, tilt: -1,
      marks: [{ box: [35, 1752, 960, 64], at: 0.3 }] },                                                                // Total: $2,400.00
    { card: 2, src: "telegram.mp4", from: 56.0, box: [15, 1540, 900, 820], label: TG, tilt: -1,
      marks: [{ box: [25, 2085, 425, 110], at: 0.25 }] },                                                              // Allow Once
    { card: 2, src: "telegram.mp4", from: 66.4, box: [15, 1290, 900, 580], label: TG, tilt: 1,
      marks: [{ box: [25, 1318, 640, 72], at: 0.15 }, { box: [25, 1625, 860, 180], at: 0.6 }] },                    // approved · sent
  ] },
  { audio: 3, shots: [
    { card: 0, src: "stripe_pay.mp4", from: 3.7, box: [40, 120, 1110, 600], label: PAY, tilt: -1,
      marks: [{ box: [80, 355, 1050, 115], at: 0.15 }] },                                                              // 4242 test card
    { card: 0, src: "stripe_paid.mp4", from: 0, box: [130, 680, 920, 540], label: PAY, tilt: 1,
      marks: [{ box: [370, 960, 600, 215], at: 0.15 }] },                                                              // Invoice paid
    { card: 1, src: "telegram.mp4", from: 115.0, box: [20, 1700, 990, 640], label: TG, tilt: -1,
      marks: [{ box: [35, 2150, 870, 175], at: 0.2 }] },                                                               // Yes, paid
  ] },
  { audio: 4, kind: "logos", shots: [] },
  { audio: 5, shots: [
    { card: 0, src: "scam.mp4", from: 7.0, box: [30, 205, 1195, 395], label: CLI, tilt: -1,
      marks: [{ box: [36, 212, 1180, 112], at: 0.3 }, { box: [36, 432, 1180, 165], at: 1.3 }] },                    // fake address · skip approval
    { card: 1, src: "scam.mp4", from: 30.9, rate: 0.5, box: [80, 1240, 1000, 318], label: CLI, tilt: 1, stampAt: 31.35,
      marks: [{ box: [86, 1296, 984, 110], at: 0.1 }, { box: [86, 1404, 984, 152], at: 0.45 }] },                   // flags · DENIED
  ] },
  { audio: 6, shots: [
    { card: 0, src: "telegram.mp4", from: 121.0, box: [15, 150, 720, 400], label: TG, tilt: -1,
      marks: [{ box: [22, 355, 580, 150], at: 0.3 }] },                                                                // Paid · Open · Overdue
  ] },
  { audio: 7, kind: "close", shots: [] },
];

type Card = { text: string; start: number; end: number };
const CAPS = captions as { beat: string; duration: number | null; cards: Card[] }[];
const fr = (sec: number) => Math.round(sec * FPS);
const DEAL = 10;        // frames: a card dealt over the previous one
const CURL = 20;        // frames: page curl between scenes
const LEAD = 0.1;       // the first line starts this far into a scene
const BEAT = 0.12;       // pause after each line before the next shot's line
const END = 0.3;       // hold after a scene's last line, before the page curls
const MIN = { intro: 5.6, logos: 4.6, close: 5.2 };
// A card's slice of its scene's voiceover: [start, end) in seconds of the clip.
const slice = (audio: number, k: number): [number, number] => {
  const cap = CAPS[audio - 1]; const c = cap.cards;
  return [c[k].start, c[k + 1]?.start ?? (cap.duration ?? c[k].end)];
};

type Plan = { shotFrames: number[]; frames: number; cues: { card: number; at: number }[] };
const plan = (sc: Scene, last: boolean): Plan => {
  const tail = last ? 0 : CURL;
  const cap = CAPS[sc.audio - 1];
  if (sc.kind) {   // illustrated scenes play the whole line once, from LEAD
    const len = Math.max(MIN[sc.kind], LEAD + (cap.duration ?? 4) + END);
    return { shotFrames: [], frames: fr(len) + tail, cues: cap.cards.map((c, k) => ({ card: k, at: LEAD + c.start })) };
  }
  const shotFrames: number[] = []; const cues: { card: number; at: number }[] = [];
  let at = 0;                                      // frames into the scene where the next shot fully lands
  const cards = [...new Set(sc.shots.map((s) => s.card))];
  cards.forEach((k, ci) => {
    const [a, b] = slice(sc.audio, k);
    const lineLen = (b - a) + (ci === 0 ? LEAD : 0) + (ci === cards.length - 1 ? END : BEAT);
    const shots = sc.shots.filter((s) => s.card === k);
    cues.push({ card: k, at: at / FPS + (ci === 0 ? LEAD : 0) });
    const each = Math.max(fr(lineLen) / shots.length, fr(1.1));   // never flash a shot past
    shots.forEach(() => {
      const f = Math.round(each);
      shotFrames.push(f + (shotFrames.length ? DEAL : 0));   // a dealt card overlaps the previous one by DEAL
      at += f;
    });
  });
  shotFrames[shotFrames.length - 1] += tail;
  return { shotFrames, frames: at + tail, cues };
};
const PLANS = SCENES.map((s, i) => plan(s, i === SCENES.length - 1));
export const DEMO_FRAMES = PLANS.reduce((a, p) => a + p.frames, 0) - CURL * (SCENES.length - 1);

/* ---------- the desk ---------- */

const Desk: React.FC = () => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 40%, #efe9de 0%, ${C.paper} 55%, #d6cdbd 100%)` }}>
    <AbsoluteFill style={{ opacity: 0.35, backgroundImage:
      "repeating-linear-gradient(0deg, rgba(0,0,0,0.018) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgba(0,0,0,0.012) 0 1px, transparent 1px 4px)" }} />
  </AbsoluteFill>
);

/* ---------- transitions ---------- */

// A card dealt over the previous one: it slides in from the right and settles; the one beneath sinks back.
const Deal: React.FC<TransitionPresentationComponentProps<Record<string, never>>> = ({ children, presentationDirection, presentationProgress: p }) => {
  const e = Easing.bezier(0.2, 0.8, 0.2, 1)(p);
  if (presentationDirection === "exiting")
    return <AbsoluteFill style={{ transform: `translateX(${-e * 4}%) scale(${1 - 0.05 * e})`, filter: `brightness(${1 - 0.25 * e})` }}>{children}</AbsoluteFill>;
  return <AbsoluteFill style={{ transform: `translateX(${(1 - e) * 105}%) rotate(${(1 - e) * 7}deg)` }}>{children}</AbsoluteFill>;
};
const deal: TransitionPresentation<Record<string, never>> = { component: Deal, props: {} };

// Page curl: the old page lifts from the right edge and rolls away to the left, uncovering the next one.
const Curl: React.FC<TransitionPresentationComponentProps<Record<string, never>>> = ({ children, presentationDirection, presentationProgress: p }) => {
  if (presentationDirection === "entering") return <AbsoluteFill>{children}</AbsoluteFill>;
  const e = Easing.bezier(0.55, 0.05, 0.35, 1)(p);
  const edge = 112 - e * 135;
  const slope = 14;
  const clip = `polygon(0% 0%, ${edge + slope}% 0%, ${edge - slope}% 100%, 0% 100%)`;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: clip, filter: `drop-shadow(0 0 30px rgba(0,0,0,${0.35 * Math.sin(Math.PI * p)}))` }}>{children}</AbsoluteFill>
      <AbsoluteFill style={{ clipPath: `polygon(${edge + slope}% 0%, ${edge + slope + 9}% 0%, ${edge - slope + 9}% 100%, ${edge - slope}% 100%)`,
        background: "linear-gradient(100deg, #b9ae9b 0%, #f6f1e7 45%, #fffdf8 60%, #cfc5b3 100%)", opacity: p < 0.98 ? 1 : 0 }} />
    </AbsoluteFill>
  );
};
const curl: TransitionPresentation<Record<string, never>> = { component: Curl, props: {} };

/* ---------- shots on cards ---------- */

const Highlight: React.FC<{ box: Box; since: number; scale: number }> = ({ box: [x, y, w, h], since, scale }) => {
  if (since < 0) return null;
  const draw = interpolate(since, [0, 0.4], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const per = 2 * (w + h) + 80;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={10} height={10}>
      <rect x={x - 6} y={y - 4} width={w + 12} height={h + 8} rx={12} fill={`rgba(222,63,135,${0.12 * draw})`}
        stroke={C.magenta} strokeWidth={6 / scale} strokeDasharray={per} strokeDashoffset={(1 - draw) * per} />
    </svg>
  );
};

const Stamp: React.FC<{ since: number; vertical: boolean }> = ({ since, vertical }) => {
  if (since < 0) return null;
  const k = interpolate(since, [0, 0.18], [2.6, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.8)) });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: vertical ? 120 : 90 }}>
      <div style={{ transform: `rotate(-9deg) scale(${k})`, opacity: Math.min(1, since * 12), padding: "10px 34px 6px", border: `9px solid ${C.stamp}`,
        outline: `3px solid ${C.stamp}`, outlineOffset: 6, color: C.stamp, fontFamily: F.grot, fontWeight: 900, fontSize: vertical ? 120 : 150,
        letterSpacing: "0.06em", background: "rgba(246,241,231,0.95)", boxShadow: "0 18px 50px rgba(0,0,0,.35)" }}>DENIED</div>
    </AbsoluteFill>
  );
};

const CAPTION_H = { v: 290, h: 160 };

const ShotCard: React.FC<{ shot: Shot; dur: number; vertical: boolean }> = ({ shot, dur, vertical }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const [sw, sh] = SIZE[shot.src];
  const areaW = width - (vertical ? 40 : 120), areaH = height - (vertical ? CAPTION_H.v : CAPTION_H.h) - (vertical ? 70 : 50);
  const [bx, by, bw, bh] = shot.box;
  const pad = 18;
  const fit = Math.min((areaW - 2 * pad) / bw, (areaH - 2 * pad) / bh);
  const push = 1 + 0.03 * interpolate(frame, [0, Math.max(1, dur)], [0, 1]);
  const settle = spring({ frame, fps, config: { damping: 18, stiffness: 120 }, durationInFrames: fr(0.8) });
  const tilt = (shot.tilt ?? 0) * (1 - settle);
  const cw = bw * fit + 2 * pad, ch = bh * fit + 2 * pad;
  const left = (width - cw) / 2, top = (vertical ? 60 : 36) + (areaH - ch) / 2;
  const rate = shot.rate ?? 1;
  const t = frame / fps;
  const stampSince = shot.stampAt != null ? t - (shot.stampAt - (shot.from ?? 0)) / rate : -1;
  const shake = stampSince >= 0 && stampSince < 0.25 ? Math.sin(stampSince * 90) * (1 - stampSince / 0.25) * 8 : 0;
  const s = fit * push;
  const isImg = shot.src.endsWith(".png");
  const dark = shot.src === "scam.mp4";
  return (
    <AbsoluteFill style={{ transform: `translate(${shake}px, ${shake * 0.6}px)` }}>
      <div style={{ position: "absolute", left, top, width: cw, height: ch, transform: `rotate(${tilt}deg)`, borderRadius: 18,
        background: "#fbf8f2", boxShadow: "0 30px 60px rgba(40,30,20,.28), 0 6px 14px rgba(40,30,20,.18)", padding: pad }}>
        <div style={{ position: "relative", width: bw * fit, height: bh * fit, overflow: "hidden", borderRadius: 10, background: dark ? "#0b0b0b" : "#fff" }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: sw, height: sh, transformOrigin: "0 0",
            transform: `translate(${-bx * s + (bw * fit - bw * s) / 2}px, ${-by * s + (bh * fit - bh * s) / 2}px) scale(${s})` }}>
            {isImg ? <Img src={staticFile(`captures/${shot.src}`)} style={{ width: sw, height: sh }} />
              : <OffthreadVideo src={staticFile(`captures/${shot.src}`)} startFrom={fr(shot.from ?? 0)} playbackRate={rate} muted style={{ width: sw, height: sh }} />}
            {(shot.marks ?? []).map((m, i) => <Highlight key={i} box={m.box} since={t - m.at} scale={s} />)}
          </div>
        </div>
        <div style={{ position: "absolute", top: -16, left: 26, fontFamily: F.mono, fontSize: vertical ? 22 : 20, fontWeight: 700, color: "#fbf8f2",
          background: C.ink, padding: "5px 12px", borderRadius: 6, letterSpacing: "0.02em" }}>{shot.label}</div>
      </div>
      <Stamp since={stampSince} vertical={vertical} />
    </AbsoluteFill>
  );
};

/* ---------- illustrated scenes ---------- */

const Paper: React.FC<{ x: number; y: number; w: number; h: number; rot: number; delay: number; children: React.ReactNode; from?: [number, number] }> =
  ({ x, y, w, h, rot, delay, children, from = [0, 900] }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig();
    const k = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 110, mass: 0.9 } });
    return (
      <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 16, background: "#fbf8f2",
        boxShadow: "0 24px 50px rgba(40,30,20,.25), 0 4px 10px rgba(40,30,20,.15)", opacity: k > 0.01 ? 1 : 0,
        transform: `translate(${(1 - k) * from[0]}px, ${(1 - k) * from[1]}px) rotate(${rot + (1 - k) * 18}deg)` }}>{children}</div>
    );
  };

const Intro: React.FC<{ vertical: boolean }> = ({ vertical }) => {
  const frame = useCurrentFrame(); const { fps, width, height } = useVideoConfig();
  const sweep = spring({ frame: frame - fr(2.6), fps, config: { damping: 18 } });
  const flip = spring({ frame: frame - fr(2.9), fps, config: { damping: 14, stiffness: 90 } });
  const deg = 180 - flip * 180;
  const cx = width / 2, cy = height / 2 - (vertical ? 150 : 70);
  const gap = vertical ? 300 : 420;
  const stamp = interpolate(frame, [fr(1.7), fr(1.95)], [2.4, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) });
  return (
    <AbsoluteFill>
      <Desk />
      <AbsoluteFill style={{ transform: `translateY(${-sweep * height * 1.1}px) rotate(${-sweep * 6}deg)` }}>
        <Paper x={cx - gap - 170} y={cy - 150} w={340} h={260} rot={-6} delay={2} from={[-700, 300]}>
          <div style={{ padding: 26, fontFamily: F.grot }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.muted, letterSpacing: "0.1em" }}>CLIENT</div>
            <div style={{ marginTop: 14, background: "#dcf8c6", borderRadius: 16, padding: "14px 18px", fontSize: 30, fontWeight: 600, color: C.ink, lineHeight: 1.2 }}>
              Loved the new site! Send the invoice 🙏</div>
          </div>
        </Paper>
        <Paper x={cx - 170} y={cy - 170} w={340} h={300} rot={3} delay={10} from={[0, 800]}>
          <div style={{ padding: 26, fontFamily: F.grot, color: C.ink }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.muted, letterSpacing: "0.1em" }}>INVOICE</div>
            <div style={{ fontSize: 64, fontWeight: 900, letterSpacing: "-0.03em", marginTop: 10 }}>$2,400</div>
            <div style={{ fontFamily: F.mono, fontSize: 24, marginTop: 6 }}>Acme Studio</div>
            <div style={{ fontFamily: F.mono, fontSize: 22, color: C.muted }}>due in 14 days</div>
          </div>
        </Paper>
        <Paper x={cx + gap - 170} y={cy - 140} w={340} h={240} rot={-3} delay={18} from={[700, 300]}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <div style={{ transform: `rotate(-8deg) scale(${stamp})`, opacity: frame > fr(1.68) ? 1 : 0, border: `6px solid ${C.stamp}`, outline: `2px solid ${C.stamp}`,
              outlineOffset: 4, color: C.stamp, fontFamily: F.grot, fontWeight: 900, fontSize: 70, padding: "4px 22px", letterSpacing: "0.08em" }}>PAID</div>
          </AbsoluteFill>
        </Paper>
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", perspective: 1800, paddingBottom: vertical ? 300 : 150, opacity: frame > fr(2.9) ? 1 : 0 }}>
        <div style={{ width: vertical ? 900 : 1100, height: vertical ? 560 : 520, position: "relative", transformStyle: "preserve-3d",
          transform: `rotateY(${deg}deg) scale(${0.85 + 0.15 * flip})` }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: 24, background: C.ink, backfaceVisibility: "hidden", transform: "rotateY(180deg)",
            boxShadow: "0 40px 80px rgba(0,0,0,.35)" }} />
          <div style={{ position: "absolute", inset: 0, borderRadius: 24, background: "#fbf8f2", backfaceVisibility: "hidden", padding: "56px 64px",
            boxShadow: "0 40px 80px rgba(40,30,20,.3)" }}>
            <div style={{ display: "inline-block", padding: "8px 16px 6px", border: `4px solid ${C.magenta}`, outline: `2px solid ${C.magenta}`, outlineOffset: 3,
              color: C.magenta, fontFamily: F.grot, fontWeight: 900, fontSize: 26, letterSpacing: "0.12em", transform: "rotate(-2deg)" }}>SECURITY-FIRST INVOICING</div>
            <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 200 : 210, lineHeight: 0.9, letterSpacing: "-0.05em", color: C.ink, marginTop: 20 }}>OBOL.</div>
            <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 40 : 44, color: C.inkSoft, marginTop: 14 }}>Invoices from any chat, for Hermes Agent</div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const LOGOS: { name: string; color: string; icon: React.ReactNode }[] = [
  { name: "Telegram", color: "#26A5E4", icon: <Img src={staticFile("logos/telegram.svg")} style={{ width: "100%", height: "100%" }} /> },
  { name: "WhatsApp", color: "#25D366", icon: <Img src={staticFile("logos/whatsapp.svg")} style={{ width: "100%", height: "100%" }} /> },
  { name: "Slack", color: "#4A154B", icon: <Img src={staticFile("logos/slack.svg")} style={{ width: "100%", height: "100%" }} /> },
  { name: "Email", color: "#3b3631", icon: (
    <svg viewBox="0 0 24 24" width="100%" height="100%"><rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M3 6l9 7 9-7" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /></svg>) },
  { name: "Terminal", color: "#151311", icon: (
    <svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M4 7l5 5-5 5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 18h8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /></svg>) },
];

const Logos: React.FC<{ vertical: boolean }> = ({ vertical }) => {
  const { width, height } = useVideoConfig();
  const size = vertical ? 290 : 300;
  const cols = vertical ? 3 : 5;
  const gap = vertical ? 30 : 40;
  const rows = Math.ceil(LOGOS.length / cols);
  const top0 = (height - (vertical ? CAPTION_H.v : CAPTION_H.h) - rows * (size + 70) - (rows - 1) * gap) / 2;
  return (
    <AbsoluteFill>
      <Desk />
      {LOGOS.map((l, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        const inRow = Math.min(cols, LOGOS.length - r * cols);
        const rowW = inRow * size + (inRow - 1) * gap;
        const x = (width - rowW) / 2 + c * (size + gap);
        const y = top0 + r * (size + 70 + gap);
        const slack = l.name === "Slack";
        return (
          <Paper key={l.name} x={x} y={y} w={size} h={size + 70} rot={[-4, 3, -2, 4, -3][i]} delay={4 + i * 6} from={[0, 900]}>
            <div style={{ position: "absolute", left: 40, top: 40, width: size - 80, height: size - 80, borderRadius: 34, background: slack ? "#fff" : l.color,
              padding: slack ? 26 : 44, boxShadow: "inset 0 0 0 2px rgba(0,0,0,.06)" }}>
              <div style={{ width: "100%", height: "100%", filter: slack || i > 2 ? "none" : "brightness(0) invert(1)" }}>{l.icon}</div>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 26, textAlign: "center", fontFamily: F.grot, fontWeight: 800, fontSize: 40, color: C.ink }}>{l.name}</div>
          </Paper>
        );
      })}
    </AbsoluteFill>
  );
};

const Close: React.FC<{ vertical: boolean }> = ({ vertical }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const up = (d: number) => spring({ frame: frame - d, fps, config: { damping: 14, mass: 0.8 } });
  const stamp = interpolate(frame, [20, 32], [2.4, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) });
  return (
    <AbsoluteFill>
      <Desk />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: vertical ? 300 : 170 }}>
        <div style={{ padding: "0 60px" }}>
          <div style={{ display: "inline-block", padding: "8px 16px 6px", border: `4px solid ${C.magenta}`, outline: `2px solid ${C.magenta}`, outlineOffset: 3,
            color: C.magenta, fontFamily: F.grot, fontWeight: 900, fontSize: 30, letterSpacing: "0.12em", transform: `rotate(-2deg) scale(${stamp})`, opacity: frame > 19 ? 1 : 0 }}>
            SECURITY-FIRST INVOICING</div>
          <div style={{ display: "flex", fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 230 : 250, lineHeight: 0.9, letterSpacing: "-0.05em", color: C.ink, marginTop: 20 }}>
            {"OBOL.".split("").map((l, i) => {
              const k = up(2 + i * 3);
              return <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - k) * 120}px)`, opacity: Math.min(1, k * 1.4) }}>{l}</span>;
            })}
          </div>
          <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 44 : 50, color: C.ink, marginTop: 16, opacity: up(14), transform: `translateY(${(1 - up(14)) * 30}px)` }}>
            A plugin for Hermes Agent</div>
          <div style={{ marginTop: 30, display: "inline-block", fontFamily: F.mono, fontWeight: 700, fontSize: vertical ? 40 : 46, color: "#fbf8f2", background: C.ink,
            padding: "16px 26px", borderRadius: 12, opacity: up(22), transform: `translateY(${(1 - up(22)) * 30}px)` }}>hermes plugins install ueddy/obol</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- captions and voice ---------- */

const Voice: React.FC<{ scene: Scene; plan: Plan; vertical: boolean }> = ({ scene, plan: pl, vertical }) => {
  const frame = useCurrentFrame();
  const cap = CAPS[scene.audio - 1];
  const t = frame / FPS;
  const i = pl.cues.findIndex((c, j) => t >= c.at && t < (pl.cues[j + 1]?.at ?? Infinity));
  const card = i >= 0 ? cap.cards[pl.cues[i].card] : null;
  const k = card ? interpolate(t - pl.cues[i].at, [0, 0.16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) }) : 0;
  const hideAt = pl.frames - (scene.audio === CAPS.length ? 0 : CURL);   // captions leave before the page curls
  return (
    <>
      {pl.cues.map((c, j) => {
        const [a, b] = slice(scene.audio, c.card);
        return (
          <Sequence key={j} from={fr(c.at)} durationInFrames={Math.max(1, fr(b - a) + 3)}>
            <Audio src={staticFile(`audio/scene${scene.audio}.mp3`)} startFrom={fr(a)} endAt={fr(b) + 3} />
          </Sequence>
        );
      })}
      {card && frame < hideAt ? (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: vertical ? 70 : 30, display: "flex", justifyContent: "center", padding: "0 36px",
          opacity: Math.min(1, k * 1.5), transform: `translateY(${(1 - k) * 14}px)` }}>
          <div style={{ maxWidth: vertical ? 1000 : 1700, padding: "14px 30px 16px", borderRadius: 14, background: "rgba(21,19,17,0.92)", color: "#fbf8f2",
            fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 60 : 62, lineHeight: 1.1, letterSpacing: "-0.015em", textAlign: "center" }}>{card.text}</div>
        </div>
      ) : null}
    </>
  );
};

const SceneView: React.FC<{ scene: Scene; plan: Plan; vertical: boolean }> = ({ scene, plan: pl, vertical }) => (
  <AbsoluteFill>
    {scene.kind === "intro" ? <Intro vertical={vertical} /> : scene.kind === "logos" ? <Logos vertical={vertical} /> : scene.kind === "close" ? <Close vertical={vertical} /> : (
      <AbsoluteFill>
        <Desk />
        <TransitionSeries>
          {scene.shots.flatMap((shot, i) => {
            const items = [];
            if (i > 0) items.push(<TransitionSeries.Transition key={`t${i}`} presentation={deal} timing={linearTiming({ durationInFrames: DEAL })} />);
            items.push(<TransitionSeries.Sequence key={`s${i}`} durationInFrames={pl.shotFrames[i]}><ShotCard shot={shot} dur={pl.shotFrames[i]} vertical={vertical} /></TransitionSeries.Sequence>);
            return items;
          })}
        </TransitionSeries>
      </AbsoluteFill>
    )}
    <Voice scene={scene} plan={pl} vertical={vertical} />
  </AbsoluteFill>
);

export const Demo: React.FC<{ vertical?: boolean }> = ({ vertical = false }) => (
  <AbsoluteFill style={{ background: C.paper }}>
    <TransitionSeries>
      {SCENES.flatMap((sc, i) => {
        const items = [<TransitionSeries.Sequence key={`c${i}`} durationInFrames={PLANS[i].frames}><SceneView scene={sc} plan={PLANS[i]} vertical={vertical} /></TransitionSeries.Sequence>];
        if (i < SCENES.length - 1) items.push(<TransitionSeries.Transition key={`x${i}`} presentation={curl} timing={linearTiming({ durationInFrames: CURL })} />);
        return items;
      })}
    </TransitionSeries>
  </AbsoluteFill>
);
