import React from "react";
import {
  AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";
import captions from "../captions.json";
import { C, F, FPS } from "./theme";

/*
 * The Obol demo, eight scenes, one voiceover clip each (public/audio/sceneN.mp3, built by demo/audio/build_vo.py,
 * captions timed in captions.json). The voice drives the cut: each scene lasts exactly as long as its line plus a
 * short join, each clip plays once, and every shot and highlight is keyed to the word it illustrates (`at` and
 * mark `t` are seconds into that scene's clip). Footage is real: Telegram Web driving Hermes's Telegram gateway,
 * the card payment page, and the Hermes terminal. Crops keep each shot to the lines that matter.
 */

type Box = [number, number, number, number];            // x, y, w, h in the source's pixels
type Mark = { box: Box; t: number };                     // highlight drawn at clip time t
type Shot = { at: number; src: string; from?: number; rate?: number; box?: Box; marks?: Mark[]; stampAt?: number; label: string; tilt?: number };
type Scene = { audio: number; shots: Shot[]; kind?: "intro" | "logos" | "close" };

const SIZE: Record<string, [number, number]> = {
  "telegram.mp4": [1170, 2532], "stripe_pay.mp4": [1170, 2532], "stripe_paid.mp4": [1170, 2532], "scam.mp4": [1240, 2000],
};
const TG = "Telegram · Hermes gateway · live";
const PAY = "Card payment page · test card";
const CLI = "Hermes terminal";
const STILL = 0.02;     // playback rate that holds a frame, so highlight boxes sit exactly on their lines
const K = 1;            // scale for word times (they are read off the final clips)

// `at` (when a shot lands) and mark `t` are word start times in each final clip (Whisper word timestamps).
const SCENES: Scene[] = [
  { audio: 1, kind: "intro", shots: [] },
  { audio: 2, shots: [   // When a client says "send me the invoice," / just forward the message to Hermes. / It reads it and drafts the invoice: / who to bill, what for, how much, and when it's due.
    { at: 0, src: "telegram.mp4", from: 9.5, rate: STILL, box: [270, 1410, 850, 430], label: TG, tilt: 1,
      marks: [{ box: [285, 1440, 820, 230], t: 1.3 }] },                                              // "send me the invoice"
    { at: 2.92, src: "telegram.mp4", from: 2.4, rate: 1, box: [20, 2180, 1130, 330], label: TG, tilt: -1 },   // forwarding it to Hermes
    { at: 5.22, src: "telegram.mp4", from: 44.6, rate: STILL, box: [10, 1400, 880, 480], label: TG, tilt: 1,
      marks: [{ box: [18, 1525, 800, 120], t: 8.06 }, { box: [18, 1648, 560, 115], t: 8.98 },        // who · what for
              { box: [40, 1772, 480, 52], t: 10.02 }, { box: [520, 1772, 340, 52], t: 11.24 }] },     // how much · when
  ] },
  { audio: 3, shots: [   // No invoice goes out until you approve it. / One tap, and your client gets a secure payment link.
    { at: 0, src: "telegram.mp4", from: 56.3, rate: STILL, box: [15, 1640, 900, 690], label: TG, tilt: -1,
      marks: [{ box: [20, 1645, 820, 125], t: 0.32 }, { box: [30, 2120, 420, 82], t: 2.14 }] },     // the invoice · Allow Once
    { at: 3.06, src: "telegram.mp4", from: 66.8, rate: STILL, box: [15, 1330, 900, 620], label: TG, tilt: 1,
      marks: [{ box: [25, 1340, 700, 60], t: 3.28 }, { box: [25, 1590, 850, 170], t: 4.18 }, { box: [25, 1897, 330, 50], t: 5.54 }] },
  ] },
  { audio: 4, shots: [   // They pay by card. / Ask Hermes "have they paid?" / and it checks for you.
    { at: 0, src: "stripe_pay.mp4", from: 3.7, rate: 0.6, box: [40, 120, 1110, 600], label: PAY, tilt: -1,
      marks: [{ box: [80, 355, 1050, 115], t: 0.3 }] },
    { at: 0.95, src: "stripe_paid.mp4", from: 0, rate: 1, box: [130, 680, 920, 540], label: PAY, tilt: 1,
      marks: [{ box: [370, 960, 600, 215], t: 1.1 }] },
    { at: 2.45, src: "telegram.mp4", from: 117.0, rate: STILL, box: [15, 1740, 1140, 230], label: TG, tilt: -1,
      marks: [{ box: [540, 1762, 375, 64], t: 2.58 }] },
    { at: 3.68, src: "telegram.mp4", from: 117.0, rate: STILL, box: [15, 2140, 900, 200], label: TG, tilt: 1,
      marks: [{ box: [22, 2148, 800, 182], t: 3.92 }] },
  ] },
  { audio: 5, kind: "logos", shots: [] },
  { audio: 6, shots: [   // Now the dangerous part. / A scammer copies… / changes one letter, / and asks for invoices… / Hermes spots the fake address and blocks it.
    { at: 0, src: "scam.mp4", from: 10.0, rate: STILL, box: [30, 205, 1195, 390], label: CLI, tilt: -1,
      marks: [{ box: [36, 268, 760, 56], t: 2.56 }] },                                                 // the copied address
    { at: 4.92, src: "compare", label: "The trick", tilt: 1 },
    { at: 6.34, src: "scam.mp4", from: 10.0, rate: STILL, box: [30, 205, 1195, 390], label: CLI, tilt: -1,
      marks: [{ box: [36, 377, 1180, 56], t: 7.46 }, { box: [36, 431, 1180, 110], t: 9.52 }] },     // new address · skip approval
    { at: 11.68, src: "scam.mp4", from: 30.9, rate: 0.27, box: [80, 1240, 1000, 318], label: CLI, tilt: 1, stampAt: 31.49,
      marks: [{ box: [86, 1404, 984, 152], t: 11.92 }] },                                            // the fake address · BLOCKED
  ] },
  { audio: 7, shots: [   // Type slash invoices to see what's paid, open and overdue.
    { at: 0, src: "telegram.mp4", from: 119.4, rate: STILL, box: [15, 2385, 1140, 100], label: TG, tilt: -1,
      marks: [{ box: [100, 2398, 230, 70], t: 0.38 }] },
    { at: 1.82, src: "telegram.mp4", from: 121.4, rate: STILL, box: [15, 345, 720, 180], label: TG, tilt: 1,
      marks: [{ box: [22, 350, 560, 54], t: 2.74 }, { box: [22, 410, 560, 54], t: 3.44 }, { box: [22, 470, 560, 54], t: 4.30 }] },
  ] },
  { audio: 8, kind: "close", shots: [] },
];

type Card = { text: string; start: number; end: number };
const CAPS = captions as { beat: string; duration: number | null; cards: Card[] }[];
const fr = (sec: number) => Math.round(sec * FPS);
const DEAL = 9;         // frames: a card dealt over the previous one (it settles as its word starts)
const CURL = 16;        // frames: page curl between scenes (the next line starts during it)
const LEAD = 0.06;      // the line starts this far into its scene
const END = 0.12;       // hold after the line, before the next scene's curl
const lineLen = (sc: Scene) => CAPS[sc.audio - 1]?.duration ?? 4;

type Plan = { shotFrames: number[]; shotStarts: number[]; frames: number };
const plan = (sc: Scene, last: boolean): Plan => {
  const body = fr(LEAD + lineLen(sc) + (last ? 0.04 : END));   // the video ends on the last word
  const frames = body + (last ? 0 : CURL);
  if (sc.kind) return { shotFrames: [], shotStarts: [], frames };
  const starts = sc.shots.map((s, i) => (i === 0 ? 0 : Math.max(0, fr(LEAD + s.at * K) - DEAL)));
  const shotFrames = starts.map((s, i) => (i < starts.length - 1 ? starts[i + 1] - s + DEAL : frames - s));
  return { shotFrames, shotStarts: starts, frames };
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

const Deal: React.FC<TransitionPresentationComponentProps<Record<string, never>>> = ({ children, presentationDirection, presentationProgress: p }) => {
  const e = Easing.bezier(0.2, 0.8, 0.2, 1)(p);
  if (presentationDirection === "exiting")
    return <AbsoluteFill style={{ transform: `translateX(${-e * 4}%) scale(${1 - 0.05 * e})`, filter: `brightness(${1 - 0.25 * e})` }}>{children}</AbsoluteFill>;
  return <AbsoluteFill style={{ transform: `translateX(${(1 - e) * 105}%) rotate(${(1 - e) * 7}deg)` }}>{children}</AbsoluteFill>;
};
const deal: TransitionPresentation<Record<string, never>> = { component: Deal, props: {} };

const Curl: React.FC<TransitionPresentationComponentProps<Record<string, never>>> = ({ children, presentationDirection, presentationProgress: p }) => {
  if (presentationDirection === "entering") return <AbsoluteFill>{children}</AbsoluteFill>;
  const e = Easing.bezier(0.55, 0.05, 0.35, 1)(p);
  const edge = 112 - e * 135; const slope = 14;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: `polygon(0% 0%, ${edge + slope}% 0%, ${edge - slope}% 100%, 0% 100%)`,
        filter: `drop-shadow(0 0 30px rgba(0,0,0,${0.35 * Math.sin(Math.PI * p)}))` }}>{children}</AbsoluteFill>
      <AbsoluteFill style={{ clipPath: `polygon(${edge + slope}% 0%, ${edge + slope + 9}% 0%, ${edge - slope + 9}% 100%, ${edge - slope}% 100%)`,
        background: "linear-gradient(100deg, #b9ae9b 0%, #f6f1e7 45%, #fffdf8 60%, #cfc5b3 100%)", opacity: p < 0.98 ? 1 : 0 }} />
    </AbsoluteFill>
  );
};
const curl: TransitionPresentation<Record<string, never>> = { component: Curl, props: {} };

/* ---------- shots on cards ---------- */

const Highlight: React.FC<{ box: Box; since: number; scale: number }> = ({ box: [x, y, w, h], since, scale }) => {
  if (since < 0) return null;
  const draw = interpolate(since, [0, 0.35], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
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
        letterSpacing: "0.06em", background: "rgba(246,241,231,0.95)", boxShadow: "0 18px 50px rgba(0,0,0,.35)" }}>BLOCKED</div>
    </AbsoluteFill>
  );
};

const CAPTION_H = { v: 290, h: 160 };

/* The real address and the scammer's, one above the other, with the swapped letters marked. */
const Compare: React.FC<{ vertical: boolean; t: number }> = ({ vertical, t }) => {
  const size = vertical ? 46 : 68;   // 31 characters must fit the card
  const row = (label: string, pre: string, mid: string, post: string, bad: boolean, delay: number) => {
    const k = interpolate(t - delay, [0, 0.35], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
    const mark = interpolate(t - delay - 0.45, [0, 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return (
      <div style={{ opacity: k, transform: `translateY(${(1 - k) * 30}px)`, marginBottom: vertical ? 36 : 44 }}>
        <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 30 : 32, letterSpacing: "0.08em", color: bad ? C.stamp : C.muted }}>{label}</div>
        <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: size, color: C.ink, marginTop: 6, whiteSpace: "nowrap" }}>
          {pre}<span style={{ position: "relative", color: bad ? C.stamp : C.ink }}>{mid}
            <span style={{ position: "absolute", left: -6, right: -6, top: -4, bottom: -8, border: `5px solid ${C.magenta}`, borderRadius: 10,
              background: "rgba(222,63,135,.12)", opacity: mark, transform: `scale(${0.6 + 0.4 * mark})` }} /></span>{post}
        </div>
      </div>
    );
  };
  return (
    <div style={{ padding: vertical ? "40px 36px" : "56px 70px" }}>
      {row("YOUR CLIENT", "billing@ac", "m", "estudio.example.com", false, 0.0)}
      {row("THE SCAMMER", "billing@ac", "rn", "estudio.example.com", true, 0.35)}
    </div>
  );
};

const ShotCard: React.FC<{ shot: Shot; dur: number; start: number; vertical: boolean }> = ({ shot, dur, start, vertical }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = frame / fps;                                    // seconds into this shot
  const clipT = (start + frame) / fps - LEAD;               // seconds into the scene's voice clip
  const settle = spring({ frame, fps, config: { damping: 18, stiffness: 120 }, durationInFrames: fr(0.8) });
  const tilt = (shot.tilt ?? 0) * (1 - settle);
  const top0 = vertical ? 60 : 36;
  const areaW = width - (vertical ? 40 : 120), areaH = height - (vertical ? CAPTION_H.v : CAPTION_H.h) - (vertical ? 70 : 50);
  const label = (
    <div style={{ position: "absolute", top: -16, left: 26, fontFamily: F.mono, fontSize: vertical ? 22 : 20, fontWeight: 700, color: "#fbf8f2",
      background: C.ink, padding: "5px 12px", borderRadius: 6, letterSpacing: "0.02em" }}>{shot.label}</div>
  );
  if (shot.src === "compare") {
    const cw = vertical ? 1000 : 1500, ch = vertical ? 300 : 400;
    return (
      <AbsoluteFill>
        <div style={{ position: "absolute", left: (width - cw) / 2, top: top0 + (areaH - ch) / 2, width: cw, height: ch, transform: `rotate(${tilt}deg)`,
          borderRadius: 18, background: "#fbf8f2", boxShadow: "0 30px 60px rgba(40,30,20,.28), 0 6px 14px rgba(40,30,20,.18)" }}>
          <Compare vertical={vertical} t={t} />{label}
        </div>
      </AbsoluteFill>
    );
  }
  const [sw, sh] = SIZE[shot.src];
  const [bx, by, bw, bh] = shot.box!;
  const pad = 18;
  const fit = Math.min((areaW - 2 * pad) / bw, (areaH - 2 * pad) / bh);
  const push = 1 + 0.03 * interpolate(frame, [0, Math.max(1, dur)], [0, 1]);
  const cw = bw * fit + 2 * pad, ch = bh * fit + 2 * pad;
  const rate = shot.rate ?? 1;
  const from = shot.from ?? 0;
  const stampSince = shot.stampAt != null ? t - (shot.stampAt - from) / rate : -1;
  const shake = stampSince >= 0 && stampSince < 0.25 ? Math.sin(stampSince * 90) * (1 - stampSince / 0.25) * 8 : 0;
  const s = fit * push;
  return (
    <AbsoluteFill style={{ transform: `translate(${shake}px, ${shake * 0.6}px)` }}>
      <div style={{ position: "absolute", left: (width - cw) / 2, top: top0 + (areaH - ch) / 2, width: cw, height: ch, transform: `rotate(${tilt}deg)`, borderRadius: 18,
        background: "#fbf8f2", boxShadow: "0 30px 60px rgba(40,30,20,.28), 0 6px 14px rgba(40,30,20,.18)", padding: pad }}>
        <div style={{ position: "relative", width: bw * fit, height: bh * fit, overflow: "hidden", borderRadius: 10, background: shot.src === "scam.mp4" ? "#0b0b0b" : "#fff" }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: sw, height: sh, transformOrigin: "0 0",
            transform: `translate(${-bx * s + (bw * fit - bw * s) / 2}px, ${-by * s + (bh * fit - bh * s) / 2}px) scale(${s})` }}>
            <OffthreadVideo src={staticFile(`captures/${shot.src}`)} startFrom={fr(from)} playbackRate={rate} muted style={{ width: sw, height: sh }} />
            {(shot.marks ?? []).map((m, i) => <Highlight key={i} box={m.box} since={clipT - m.t * K} scale={s} />)}
          </div>
        </div>
        {label}
      </div>
      <Stamp since={stampSince} vertical={vertical} />
    </AbsoluteFill>
  );
};

/* ---------- illustrated scenes ---------- */

const Paper: React.FC<{ x: number; y: number; w: number; h: number; rot: number; delay: number; children: React.ReactNode; from?: [number, number] }> =
  ({ x, y, w, h, rot, delay, children, from = [0, 900] }) => {
    const frame = useCurrentFrame(); const { fps } = useVideoConfig();
    const k = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 120, mass: 0.8 } });
    return (
      <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 16, background: "#fbf8f2",
        boxShadow: "0 24px 50px rgba(40,30,20,.25), 0 4px 10px rgba(40,30,20,.15)", opacity: k > 0.01 ? 1 : 0,
        transform: `translate(${(1 - k) * from[0]}px, ${(1 - k) * from[1]}px) rotate(${rot + (1 - k) * 18}deg)` }}>{children}</div>
    );
  };

const Wordmark: React.FC<{ vertical: boolean; sub: string; extra?: React.ReactNode }> = ({ vertical, sub, extra }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const up = (d: number) => spring({ frame: frame - d, fps, config: { damping: 14, mass: 0.7 } });
  const stamp = interpolate(frame, [10, 20], [2.4, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) });
  return (
    <div style={{ padding: "0 60px" }}>
      <div style={{ display: "inline-block", padding: "8px 16px 6px", border: `4px solid ${C.magenta}`, outline: `2px solid ${C.magenta}`, outlineOffset: 3,
        color: C.magenta, fontFamily: F.grot, fontWeight: 900, fontSize: 30, letterSpacing: "0.12em", transform: `rotate(-2deg) scale(${stamp})`, opacity: frame > 9 ? 1 : 0 }}>
        SECURITY-FIRST INVOICING</div>
      <div style={{ display: "flex", fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 230 : 250, lineHeight: 0.9, letterSpacing: "-0.05em", color: C.ink, marginTop: 20 }}>
        {"OBOL.".split("").map((l, i) => {
          const k = up(i * 2);
          return <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - k) * 110}px)`, opacity: Math.min(1, 0.2 + k) }}>{l}</span>;
        })}
      </div>
      <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 46 : 52, color: C.ink, marginTop: 16, opacity: up(8), transform: `translateY(${(1 - up(8)) * 30}px)` }}>{sub}</div>
      {extra}
    </div>
  );
};

const Intro: React.FC<{ vertical: boolean }> = ({ vertical }) => {
  // "This is Obol, a plugin that lets Hermes Agent handle your invoices, / right from your chats."
  const chatsAt = fr(LEAD + (CAPS[0].cards[1]?.start ?? 5));
  const { width, height } = useVideoConfig();
  const bw = vertical ? 470 : 520;
  return (
    <AbsoluteFill>
      <Desk />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: vertical ? 420 : 300 }}>
        <Wordmark vertical={vertical} sub="A plugin for Hermes Agent" />
      </AbsoluteFill>
      <Paper x={width / 2 - bw - 20} y={height - (vertical ? 560 : 420)} w={bw} h={130} rot={-3} delay={chatsAt - 8} from={[-600, 200]}>
        <div style={{ margin: 18, background: "#dcf8c6", borderRadius: 16, padding: "14px 20px", fontFamily: F.grot, fontSize: 32, fontWeight: 700, color: C.ink }}>
          Send me the invoice 🙏</div>
      </Paper>
      <Paper x={width / 2 + 20} y={height - (vertical ? 540 : 400)} w={bw} h={130} rot={2} delay={chatsAt + 4} from={[600, 200]}>
        <div style={{ margin: 18, background: "#eef1f6", borderRadius: 16, padding: "14px 20px", fontFamily: F.grot, fontSize: 32, fontWeight: 700, color: C.ink }}>
          Invoice drafted: $2,400 ✓</div>
      </Paper>
    </AbsoluteFill>
  );
};

const LOGOS: { name: string; color: string; t: number; icon: React.ReactNode }[] = [
  { name: "Telegram", color: "#26A5E4", t: 0.70, icon: <Img src={staticFile("logos/telegram.svg")} style={{ width: "100%", height: "100%" }} /> },
  { name: "WhatsApp", color: "#25D366", t: 1.84, icon: <Img src={staticFile("logos/whatsapp.svg")} style={{ width: "100%", height: "100%" }} /> },
  { name: "Slack", color: "#4A154B", t: 3.00, icon: <Img src={staticFile("logos/slack.svg")} style={{ width: "100%", height: "100%" }} /> },
  { name: "Email", color: "#3b3631", t: 3.58, icon: (
    <svg viewBox="0 0 24 24" width="100%" height="100%"><rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M3 6l9 7 9-7" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /></svg>) },
  { name: "Terminal", color: "#151311", t: 4.78, icon: (
    <svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M4 7l5 5-5 5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 18h8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /></svg>) },
];

const Logos: React.FC<{ vertical: boolean }> = ({ vertical }) => {
  const { width, height } = useVideoConfig();
  const size = vertical ? 290 : 300, cols = vertical ? 3 : 5, gap = vertical ? 30 : 40;
  const rows = Math.ceil(LOGOS.length / cols);
  const top0 = (height - (vertical ? CAPTION_H.v : CAPTION_H.h) - rows * (size + 70) - (rows - 1) * gap) / 2;
  return (
    <AbsoluteFill>
      <Desk />
      {LOGOS.map((l, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        const inRow = Math.min(cols, LOGOS.length - r * cols);
        const rowW = inRow * size + (inRow - 1) * gap;
        const slack = l.name === "Slack";
        return (
          <Paper key={l.name} x={(width - rowW) / 2 + c * (size + gap)} y={top0 + r * (size + 70 + gap)} w={size} h={size + 70}
            rot={[-4, 3, -2, 4, -3][i]} delay={fr(LEAD + l.t * K) - 6} from={[0, 900]}>
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
  const k = spring({ frame: frame - 14, fps, config: { damping: 14, mass: 0.7 } });
  return (
    <AbsoluteFill>
      <Desk />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: vertical ? 300 : 170 }}>
        <Wordmark vertical={vertical} sub="Invoicing for Hermes Agent, with security built in." extra={
          <div style={{ marginTop: 30, display: "inline-block", fontFamily: F.mono, fontWeight: 700, fontSize: vertical ? 40 : 46, color: "#fbf8f2", background: C.ink,
            padding: "16px 26px", borderRadius: 12, opacity: k, transform: `translateY(${(1 - k) * 30}px)` }}>hermes plugins install ueddy/obol</div>} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- captions and voice ---------- */

const Voice: React.FC<{ scene: Scene; frames: number; last: boolean; vertical: boolean }> = ({ scene, frames, last, vertical }) => {
  const frame = useCurrentFrame();
  const cap = CAPS[scene.audio - 1];
  const t = frame / FPS - LEAD;
  const card = frame < frames - (last ? 0 : CURL) ? cap?.cards.find((c, i) => t >= c.start - 0.05 && (i === cap.cards.length - 1 || t < cap.cards[i + 1].start - 0.05)) : null;
  const k = card ? interpolate(t - card.start, [-0.05, 0.12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) }) : 0;
  return (
    <>
      {/* one clip per scene, played once */}
      <Sequence from={fr(LEAD)} durationInFrames={fr(lineLen(scene)) + 2}><Audio src={staticFile(`audio/scene${scene.audio}.mp3`)} /></Sequence>
      {card ? (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: vertical ? 70 : 30, display: "flex", justifyContent: "center", padding: "0 36px",
          opacity: Math.min(1, k * 1.5), transform: `translateY(${(1 - k) * 12}px)` }}>
          <div style={{ maxWidth: vertical ? 1000 : 1700, padding: "14px 30px 16px", borderRadius: 14, background: "rgba(21,19,17,0.92)", color: "#fbf8f2",
            fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 58 : 60, lineHeight: 1.1, letterSpacing: "-0.015em", textAlign: "center" }}>{card.text}</div>
        </div>
      ) : null}
    </>
  );
};

const SceneView: React.FC<{ scene: Scene; plan: Plan; last: boolean; vertical: boolean }> = ({ scene, plan: pl, last, vertical }) => (
  <AbsoluteFill>
    {scene.kind === "intro" ? <Intro vertical={vertical} /> : scene.kind === "logos" ? <Logos vertical={vertical} /> : scene.kind === "close" ? <Close vertical={vertical} /> : (
      <AbsoluteFill>
        <Desk />
        <TransitionSeries>
          {scene.shots.flatMap((shot, i) => {
            const items = [];
            if (i > 0) items.push(<TransitionSeries.Transition key={`t${i}`} presentation={deal} timing={linearTiming({ durationInFrames: DEAL })} />);
            items.push(<TransitionSeries.Sequence key={`s${i}`} durationInFrames={pl.shotFrames[i]}>
              <ShotCard shot={shot} dur={pl.shotFrames[i]} start={pl.shotStarts[i]} vertical={vertical} /></TransitionSeries.Sequence>);
            return items;
          })}
        </TransitionSeries>
      </AbsoluteFill>
    )}
    <Voice scene={scene} frames={pl.frames} last={last} vertical={vertical} />
  </AbsoluteFill>
);

export const Demo: React.FC<{ vertical?: boolean }> = ({ vertical = false }) => (
  <AbsoluteFill style={{ background: C.paper }}>
    <TransitionSeries>
      {SCENES.flatMap((sc, i) => {
        const last = i === SCENES.length - 1;
        const items = [<TransitionSeries.Sequence key={`c${i}`} durationInFrames={PLANS[i].frames}><SceneView scene={sc} plan={PLANS[i]} last={last} vertical={vertical} /></TransitionSeries.Sequence>];
        if (!last) items.push(<TransitionSeries.Transition key={`x${i}`} presentation={curl} timing={linearTiming({ durationInFrames: CURL })} />);
        return items;
      })}
    </TransitionSeries>
  </AbsoluteFill>
);
