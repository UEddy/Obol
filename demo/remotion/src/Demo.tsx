import React from "react";
import { AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import vo from "../vo70.json";
import { C, F, FPS } from "./theme";

/*
 * The Obol demo: exactly 70.0 s, eleven scenes at fixed windows. Each scene's voiceover clip (built at its original
 * speed by demo/audio/build_vo70.py, timed in vo70.json) plays once, 0.3 s after the scene starts. Shots, highlights,
 * labels and stamps are keyed to word start times (`at`, `t`: seconds into that scene's clip). All footage is real
 * plugin output: Telegram Web driving Hermes's Telegram gateway, the card payment page, the Hermes terminal, and
 * the Obol dashboard. No music: the gaps between lines are left clean.
 */

type Box = [number, number, number, number];            // x, y, w, h in the source's pixels
type Mark = { box: Box; t: number };
type Shot = { at: number; src: string; from?: number; rate?: number; box?: Box; marks?: Mark[]; stamp?: number; label: string };
type Chip = { label: string; at: number; tone?: "ink" | "red" | "green" };
type SceneDef = { kind: "shots" | "logo" | "tray" | "close"; shots?: Shot[]; chips?: Chip[] };
type Word = { w: string; start: number; end: number };
type Card = { text: string; start: number; end: number };
type VoScene = { scene: number; start: number; end: number; clip: string; clip_len: number; cards: Card[]; words: Word[] };
const VO = vo as unknown as { total: number; lead: number; scenes: VoScene[] };

const fr = (s: number) => Math.round(s * FPS);
export const DEMO_FRAMES = fr(VO.total);
const LEAD = VO.lead;
const STILL = 0.02;   // holds a frame of a video, so highlight boxes sit exactly on their lines

const SIZE: Record<string, [number, number]> = {
  "telegram.mp4": [1170, 2532], "stripe_pay.mp4": [1170, 2532], "stripe_paid.mp4": [1170, 2532],
  "scam.mp4": [1240, 2000], "flags.mp4": [1240, 2000], "checks.mp4": [1240, 2000],
  "dash-invoices.png": [3200, 2000], "row-hidden.png": [2484, 192], "row-encoded.png": [2484, 158],
  "row-translated.png": [2484, 192], "row-unattended.png": [2484, 192], "row-fraud.png": [2484, 138], "row-dispute.png": [2484, 122],
};
const TG = "Telegram · Hermes";
const PAY = "Payment page · test card";
const CLI = "Hermes terminal";
const DASH = "Dashboard";

const SCENES: SceneDef[] = [
  /* 1 */ { kind: "logo" },
  /* 2 A client messages: "send me the invoice." Forward it to Hermes, and it drafts one: who to bill, what for, how much, and when. */
  { kind: "shots", shots: [
    { at: 0, src: "telegram.mp4", from: 9.5, rate: STILL, box: [270, 1410, 850, 430], label: TG, marks: [{ box: [285, 1440, 820, 230], t: 0.82 }] },
    { at: 2.14, src: "telegram.mp4", from: 3.0, rate: 1.4, box: [20, 2300, 1130, 210], label: TG },
    { at: 4.04, src: "telegram.mp4", from: 44.6, rate: STILL, box: [10, 1400, 880, 480], label: TG, marks: [
      { box: [18, 1525, 800, 120], t: 4.64 }, { box: [18, 1648, 560, 115], t: 5.6 }, { box: [40, 1772, 480, 52], t: 6.44 }, { box: [520, 1772, 340, 52], t: 7.54 }] },
  ] },
  /* 3 No invoice is sent without your approval, every time. Then your client gets a payment link. */
  { kind: "shots", chips: [{ label: "Approval required, every time", at: 1.58, tone: "red" }], shots: [
    { at: 0, src: "telegram.mp4", from: 56.3, rate: STILL, box: [15, 1780, 900, 550], label: TG, marks: [{ box: [30, 2120, 420, 82], t: 1.58 }] },
    { at: 3.8, src: "telegram.mp4", from: 66.8, rate: STILL, box: [15, 1330, 900, 620], label: TG, marks: [
      { box: [25, 1340, 700, 60], t: 3.9 }, { box: [25, 1590, 850, 170], t: 4.2 }, { box: [25, 1897, 330, 50], t: 4.72 }] },
  ] },
  /* 4 They pay by card. Ask Hermes, "have they paid?" and it checks. */
  { kind: "shots", shots: [
    { at: 0, src: "stripe_pay.mp4", from: 3.7, rate: 0.6, box: [40, 120, 1110, 600], label: PAY, marks: [{ box: [80, 355, 1050, 115], t: 0.15 }] },
    { at: 0.75, src: "stripe_paid.mp4", from: 0, rate: 1, box: [130, 680, 920, 540], label: PAY, marks: [{ box: [370, 960, 600, 215], t: 0.85 }] },
    { at: 1.4, src: "telegram.mp4", from: 117.0, rate: STILL, box: [15, 1740, 1140, 230], label: TG, marks: [{ box: [540, 1762, 375, 64], t: 2.34 }] },
    { at: 3.1, src: "telegram.mp4", from: 117.0, rate: STILL, box: [15, 2140, 900, 200], label: TG, marks: [{ box: [22, 2148, 800, 182], t: 3.26 }] },
  ] },
  /* 5 Works in Telegram, WhatsApp, Slack, email or terminal. */
  { kind: "tray" },
  /* 6 Now, a scam. Someone copies your client's email, changes one letter, and tells Hermes to skip your approval.
       Hermes flags the lookalike address, the impersonation, and the injected order. */
  { kind: "shots", chips: [{ label: "Lookalike domain", at: 8.08, tone: "red" }, { label: "Impersonation", at: 9.26, tone: "red" },
    { label: "Prompt injection", at: 10.64, tone: "red" }], shots: [
    { at: 0, src: "scam.mp4", from: 10.0, rate: STILL, box: [30, 205, 1195, 390], label: CLI, marks: [{ box: [36, 268, 760, 56], t: 1.9 }] },
    { at: 3.3, src: "compare", label: "The trick" },
    { at: 5.35, src: "scam.mp4", from: 10.0, rate: STILL, box: [30, 205, 1195, 390], label: CLI, marks: [{ box: [36, 431, 1180, 110], t: 5.72 }] },
    { at: 7.2, src: "scam.mp4", from: 29.6, rate: 0.3, box: [80, 1240, 1000, 318], label: CLI, stamp: 7.54, marks: [
      { box: [86, 1404, 984, 152], t: 8.08 }, { box: [86, 1296, 984, 110], t: 9.26 }] },
    { at: 10.4, src: "scam.mp4", from: 25.7, rate: STILL, box: [20, 270, 1200, 530], label: CLI, marks: [{ box: [26, 556, 1188, 130], t: 10.64 }] },
  ] },
  /* 7 Hidden, encoded or translated tricks get caught too, plus duplicates, odd amounts and changed contact details. */
  { kind: "shots", chips: [{ label: "Hidden", at: 0.0 }, { label: "Encoded", at: 0.46 }, { label: "Translated", at: 1.22 },
    { label: "Duplicate", at: 3.52 }, { label: "Unusual amount", at: 4.48 }, { label: "Details changed", at: 5.18 }], shots: [
    { at: 0, src: "row-hidden.png", box: [1200, 0, 760, 192], label: "Dashboard · Security", marks: [{ box: [1222, 58, 730, 42], t: 0.1 }] },
    { at: 0.46, src: "row-encoded.png", box: [1200, 0, 760, 158], label: "Dashboard · Security", marks: [{ box: [1222, 58, 730, 42], t: 0.6 }] },
    { at: 1.22, src: "row-translated.png", box: [1200, 0, 760, 192], label: "Dashboard · Security", marks: [{ box: [1222, 92, 730, 42], t: 1.4 }] },
    { at: 3.2, src: "flags.mp4", from: 8.5, rate: STILL, box: [70, 1300, 1120, 360], label: CLI, marks: [
      { box: [80, 1352, 1080, 108], t: 3.52 }, { box: [80, 1460, 1080, 108], t: 4.48 }, { box: [80, 1568, 1080, 56], t: 5.18 }] },
  ] },
  /* 8 After payment, it shows fraud risk and disputes. Live keys stay locked by default. */
  { kind: "shots", chips: [{ label: "Fraud risk", at: 1.24, tone: "red" }, { label: "Disputes", at: 2.14, tone: "red" }, { label: "Live keys locked", at: 3.48 }], shots: [
    { at: 0, src: "row-fraud.png", box: [1200, 0, 760, 138], label: "Dashboard · Security", marks: [{ box: [1222, 22, 735, 94], t: 1.24 }] },
    { at: 1.95, src: "row-dispute.png", box: [1200, 0, 760, 122], label: "Dashboard · Security", marks: [{ box: [1222, 18, 735, 86], t: 2.14 }] },
    { at: 3.3, src: "checks.mp4", from: 3.0, rate: STILL, box: [20, 122, 1220, 485], label: CLI, marks: [{ box: [24, 545, 1210, 60], t: 3.56 }] },
  ] },
  /* 9 Scheduled runs can't send invoices, and logs expose any tampering. */
  { kind: "shots", chips: [{ label: "Scheduled runs blocked", at: 0.0, tone: "red" }, { label: "Tamper-evident logs", at: 2.34 }], shots: [
    { at: 0, src: "row-unattended.png", box: [1215, 48, 745, 144], label: "Dashboard · Security", marks: [{ box: [1222, 54, 730, 76], t: 0.42 }] },
    { at: 1.88, src: "checks.mp4", from: 9.0, rate: STILL, box: [20, 30, 1220, 405], label: CLI, marks: [
      { box: [24, 34, 1210, 108], t: 1.95 }, { box: [24, 380, 1210, 52], t: 2.6 }] },
  ] },
  /* 10 Paid, open and overdue: on your dashboard, or type slash invoices. */
  { kind: "shots", shots: [
    { at: 0, src: "dash-invoices.png", box: [2260, 575, 820, 315], label: DASH, marks: [{ box: [2269, 581, 802, 298], t: 0.0 }] },
    { at: 0.68, src: "dash-invoices.png", box: [578, 572, 822, 315], label: DASH, marks: [{ box: [587, 578, 804, 303], t: 0.68 }] },
    { at: 1.3, src: "dash-invoices.png", box: [1419, 580, 822, 315], label: DASH, marks: [{ box: [1428, 588, 803, 300], t: 1.3 }] },
    { at: 2.7, src: "telegram.mp4", from: 119.4, rate: STILL, box: [15, 2385, 1140, 100], label: TG, marks: [{ box: [100, 2398, 230, 70], t: 3.5 }] },
    { at: 3.95, src: "telegram.mp4", from: 121.4, rate: STILL, box: [15, 345, 720, 180], label: TG, marks: [{ box: [22, 350, 560, 170], t: 4.1 }] },
  ] },
  /* 11 Obol. Safe invoicing for Hermes Agent. */
  { kind: "close" },
];

/* ---------- layout ---------- */

const useLayout = () => {
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  const chipH = vertical ? 170 : 120, capH = vertical ? 300 : 175;
  return { width, height, vertical, chipH, capH, areaTop: chipH, areaH: height - chipH - capH };
};

const Desk: React.FC = () => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 40%, #f1ebe0 0%, ${C.paper} 55%, #d4cab8 100%)` }}>
    <AbsoluteFill style={{ opacity: 0.4, backgroundImage:
      "repeating-linear-gradient(0deg, rgba(0,0,0,0.018) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgba(0,0,0,0.012) 0 1px, transparent 1px 4px)" }} />
  </AbsoluteFill>
);

/* ---------- pieces ---------- */

const Highlight: React.FC<{ box: Box; since: number; scale: number }> = ({ box: [x, y, w, h], since, scale }) => {
  if (since < 0) return null;
  const draw = interpolate(since, [0, 0.3], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const per = 2 * (w + h) + 80;
  return (
    <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} width={10} height={10}>
      <rect x={x - 6} y={y - 4} width={w + 12} height={h + 8} rx={12} fill={`rgba(222,63,135,${0.13 * draw})`}
        stroke={C.magenta} strokeWidth={6 / scale} strokeDasharray={per} strokeDashoffset={(1 - draw) * per} />
    </svg>
  );
};

const Stamp: React.FC<{ text: string; since: number; size: number }> = ({ text, since, size }) => {
  if (since < 0) return null;
  const k = interpolate(since, [0, 0.16], [2.6, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(1.8)) });
  return (
    <div style={{ transform: `rotate(-9deg) scale(${k})`, opacity: Math.min(1, since * 14), padding: "8px 30px 4px", border: `9px solid ${C.stamp}`,
      outline: `3px solid ${C.stamp}`, outlineOffset: 6, color: C.stamp, fontFamily: F.grot, fontWeight: 900, fontSize: size,
      letterSpacing: "0.06em", background: "rgba(246,241,231,0.95)", boxShadow: "0 18px 50px rgba(0,0,0,.35)" }}>{text}</div>
  );
};

/* The real address and the scammer's, one above the other, with the changed letter marked. */
const Compare: React.FC<{ vertical: boolean; t: number }> = ({ vertical, t }) => {
  const size = vertical ? 46 : 70;
  const row = (label: string, mid: string, bad: boolean, delay: number) => {
    const k = interpolate(t - delay, [-0.35, 0.1], [0.35, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
    const mark = interpolate(t - 0.4, [0, 0.25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return (
      <div style={{ opacity: k, transform: `translateY(${(1 - k) * 30}px)`, marginBottom: vertical ? 30 : 40 }}>
        <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: vertical ? 30 : 34, letterSpacing: "0.08em", color: bad ? C.stamp : C.muted }}>{label}</div>
        <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: size, color: C.ink, marginTop: 6, whiteSpace: "nowrap" }}>
          billing@ac<span style={{ position: "relative", color: bad ? C.stamp : C.ink }}>{mid}
            <span style={{ position: "absolute", left: -7, right: -7, top: -5, bottom: -9, border: `6px solid ${C.magenta}`, borderRadius: 10,
              background: "rgba(222,63,135,.14)", opacity: mark, transform: `scale(${0.5 + 0.5 * mark})` }} /></span>estudio.example.com
        </div>
      </div>
    );
  };
  return (
    <div style={{ padding: vertical ? "34px 34px" : "50px 66px" }}>
      {row("YOUR CLIENT", "m", false, 0)}
      {row("THE SCAMMER", "rn", true, 0.15)}
    </div>
  );
};

const Paper: React.FC<{ style: React.CSSProperties; children: React.ReactNode }> = ({ style, children }) => (
  <div style={{ background: "#fbf8f2", borderRadius: 18, boxShadow: "0 30px 60px rgba(40,30,20,.28), 0 6px 14px rgba(40,30,20,.18)", ...style }}>{children}</div>
);

const Label: React.FC<{ text: string; vertical: boolean }> = ({ text, vertical }) => (
  <div style={{ position: "absolute", top: -18, left: 26, fontFamily: F.mono, fontSize: vertical ? 24 : 22, fontWeight: 700, color: "#fbf8f2",
    background: C.ink, padding: "5px 12px", borderRadius: 6 }}>{text}</div>
);

/* A footage card dealt onto the desk at `at`, sitting over the previous one. */
const ShotCard: React.FC<{ shot: Shot; startF: number; endF: number }> = ({ shot, startF, endF }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const local = frame;                                    // frames since this card was dealt
  const clipT = (startF + frame) / fps - LEAD;            // seconds into the scene's voice clip
  const deal = spring({ frame: local, fps, config: { damping: 17, stiffness: 140, mass: 0.8 }, durationInFrames: 14 });
  const enter = startF === 0 ? 1 : deal;
  const tx = (1 - enter) * L.width * 1.05, rot = (1 - enter) * 7;
  const settle = spring({ frame: local - 6, fps, config: { damping: 18 } });
  const tilt = (startF === 0 ? 0 : 1.2) * (1 - settle) * (shot.at % 2 > 1 ? -1 : 1);
  const maxW = L.width - (L.vertical ? 40 : 140), maxH = L.areaH - (L.vertical ? 60 : 50);
  if (shot.src === "compare") {
    const cw = L.vertical ? 1010 : 1500, ch = L.vertical ? 300 : 390;
    return (
      <AbsoluteFill style={{ transform: `translateX(${tx}px) rotate(${rot + tilt}deg)` }}>
        <Paper style={{ position: "absolute", left: (L.width - cw) / 2, top: L.areaTop + (L.areaH - ch) / 2, width: cw, height: ch }}>
          <Compare vertical={L.vertical} t={clipT - shot.at} /><Label text={shot.label} vertical={L.vertical} />
        </Paper>
      </AbsoluteFill>
    );
  }
  const [sw, sh] = SIZE[shot.src];
  const [bx, by, bw, bh] = shot.box!;
  const pad = 18;
  const fit = Math.min((maxW - 2 * pad) / bw, (maxH - 2 * pad) / bh);
  const push = 1 + 0.035 * interpolate(local, [0, Math.max(1, endF - startF)], [0, 1]);
  const s = fit * push;
  const cw = bw * fit + 2 * pad, ch = bh * fit + 2 * pad;
  const isImg = shot.src.endsWith(".png");
  const dark = /scam|flags|checks/.test(shot.src);
  const stampSince = shot.stamp != null ? clipT - shot.stamp : -1;
  const shake = stampSince >= 0 && stampSince < 0.25 ? Math.sin(stampSince * 90) * (1 - stampSince / 0.25) * 9 : 0;
  return (
    <AbsoluteFill style={{ transform: `translate(${tx + shake}px, ${shake * 0.6}px) rotate(${rot + tilt}deg)` }}>
      <Paper style={{ position: "absolute", left: (L.width - cw) / 2, top: L.areaTop + (L.areaH - ch) / 2, width: cw, height: ch, padding: pad }}>
        <div style={{ position: "relative", width: bw * fit, height: bh * fit, overflow: "hidden", borderRadius: 10, background: dark ? "#0b0b0b" : "#fff" }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: sw, height: sh, transformOrigin: "0 0",
            transform: `translate(${-bx * s + (bw * fit - bw * s) / 2}px, ${-by * s + (bh * fit - bh * s) / 2}px) scale(${s})` }}>
            {isImg ? <Img src={staticFile(`captures/${shot.src}`)} style={{ width: sw, height: sh }} />
              : <OffthreadVideo src={staticFile(`captures/${shot.src}`)} startFrom={fr(shot.from ?? 0)} playbackRate={shot.rate ?? 1} muted style={{ width: sw, height: sh }} />}
            {(shot.marks ?? []).map((m, i) => <Highlight key={i} box={m.box} since={clipT - m.t} scale={s} />)}
          </div>
        </div>
        <Label text={shot.label} vertical={L.vertical} />
      </Paper>
      {stampSince >= 0 ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: L.areaTop + (L.areaH + ch) / 2 - (L.vertical ? 10 : 40), display: "flex", justifyContent: "center" }}>
          <Stamp text="DENIED" since={stampSince} size={L.vertical ? 110 : 130} />
        </div>) : null}
    </AbsoluteFill>
  );
};

/* Paper labels slapped onto the desk as each one is named; they stay for the rest of the scene. */
const Chips: React.FC<{ chips: Chip[] }> = ({ chips }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const L = useLayout();
  const clipT = frame / fps - LEAD;
  const shown = chips.filter((c) => clipT >= c.at - 0.05);
  const bg = { ink: C.ink, red: C.stamp, green: "#1f7a4d" };
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: L.vertical ? 26 : 22, height: L.chipH - 30, display: "flex", flexWrap: "wrap",
      justifyContent: "center", alignContent: "center", gap: L.vertical ? "12px 14px" : 18, padding: "0 30px" }}>
      {shown.map((c, i) => {
        const k = spring({ frame: frame - fr(LEAD + c.at - 0.05), fps, config: { damping: 11, stiffness: 180, mass: 0.6 } });
        return (
          <div key={c.label} style={{ position: "relative", transform: `scale(${1.7 - 0.7 * k}) rotate(${[-3, 2, -2, 3, -1, 2][i % 6]}deg)`, opacity: Math.min(1, k * 2) }}>
            <div style={{ position: "absolute", top: -10, left: "50%", width: 54, height: 18, marginLeft: -27, background: "rgba(240,226,180,.85)", transform: "rotate(-4deg)" }} />
            <div style={{ fontFamily: F.grot, fontWeight: 900, fontSize: L.vertical ? 36 : 40, letterSpacing: "0.02em", color: "#fbf8f2", background: bg[c.tone ?? "ink"],
              padding: L.vertical ? "8px 18px 9px" : "10px 22px 11px", borderRadius: 8, boxShadow: "0 8px 18px rgba(0,0,0,.25)", whiteSpace: "nowrap" }}>{c.label}</div>
          </div>
        );
      })}
    </div>
  );
};

const Wordmark: React.FC<{ sub: string; stampAt?: number; stampText?: string; extra?: React.ReactNode }> = ({ sub, stampAt, stampText, extra }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const L = useLayout();
  const up = (d: number) => spring({ frame: frame - d, fps, config: { damping: 14, mass: 0.7 } });
  const clipT = frame / fps - LEAD;
  return (
    <div style={{ padding: "0 60px", position: "relative" }}>
      <div style={{ display: "flex", fontFamily: F.grot, fontWeight: 800, fontSize: L.vertical ? 240 : 270, lineHeight: 0.9, letterSpacing: "-0.05em", color: C.ink }}>
        {"OBOL.".split("").map((l, i) => {
          const k = up(i * 2);
          return <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - k) * 110}px)`, opacity: Math.min(1, 0.15 + k) }}>{l}</span>;
        })}
      </div>
      <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: L.vertical ? 50 : 56, color: C.ink, marginTop: 18, opacity: up(8), transform: `translateY(${(1 - up(8)) * 30}px)` }}>{sub}</div>
      {extra}
      {stampAt != null && stampText ? (
        <div style={{ position: "absolute", right: L.vertical ? 0 : -40, top: L.vertical ? -130 : -110 }}>
          <Stamp text={stampText} since={clipT - stampAt} size={L.vertical ? 40 : 46} />
        </div>) : null}
    </div>
  );
};

const Logo: React.FC = () => {
  const frame = useCurrentFrame();
  const L = useLayout();
  const push = 1 + 0.06 * interpolate(frame, [0, fr(5)], [0, 1]);   // gentle push-in
  return (
    <AbsoluteFill>
      <Desk />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: L.capH - 40, transform: `scale(${push})` }}>
        <Paper style={{ padding: L.vertical ? "60px 40px" : "70px 90px", transform: "rotate(-1.2deg)" }}>
          <Wordmark sub="A plugin for Hermes Agent" stampAt={3.1} stampText="SECURITY AT EVERY STEP" />
        </Paper>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const TILES: { name: string; word: string; color: string; icon: React.ReactNode }[] = [
  { name: "Telegram", word: "Telegram,", color: "#26A5E4", icon: <Img src={staticFile("logos/telegram.svg")} style={{ width: "100%", height: "100%", filter: "brightness(0) invert(1)" }} /> },
  { name: "WhatsApp", word: "WhatsApp,", color: "#25D366", icon: <Img src={staticFile("logos/whatsapp.svg")} style={{ width: "100%", height: "100%", filter: "brightness(0) invert(1)" }} /> },
  { name: "Slack", word: "Slack,", color: "#ffffff", icon: <Img src={staticFile("logos/slack.svg")} style={{ width: "100%", height: "100%" }} /> },
  { name: "Email", word: "email", color: "#3b3631", icon: (
    <svg viewBox="0 0 24 24" width="100%" height="100%"><rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M3 6l9 7 9-7" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /></svg>) },
  { name: "Terminal", word: "terminal.", color: "#151311", icon: (
    <svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M4 7l5 5-5 5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 18h8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /></svg>) },
];

/* A tray with five slots; each tile drops into its slot as its name is spoken. */
const Tray: React.FC<{ words: Word[] }> = ({ words }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const L = useLayout();
  const cols = L.vertical ? 3 : 5, size = L.vertical ? 280 : 290, gap = L.vertical ? 26 : 30;
  const rows = Math.ceil(TILES.length / cols);
  const trayW = cols * size + (cols + 1) * gap, trayH = rows * (size + 64) + (rows + 1) * gap;
  const left = (L.width - trayW) / 2, top = L.areaTop + (L.areaH - trayH) / 2;
  return (
    <AbsoluteFill>
      <Desk />
      <div style={{ position: "absolute", left, top, width: trayW, height: trayH, borderRadius: 22, background: "#e2d8c6",
        boxShadow: "inset 0 6px 18px rgba(60,40,20,.25), 0 20px 40px rgba(40,30,20,.2)" }} />
      {TILES.map((tile, i) => {
        const r = Math.floor(i / cols), c = i % cols;
        const inRow = Math.min(cols, TILES.length - r * cols);
        const x = left + (trayW - (inRow * size + (inRow - 1) * gap)) / 2 + c * (size + gap);
        const y = top + gap + r * (size + 64 + gap);
        const at = words.find((w) => w.w === tile.word)?.start ?? i;
        const k = spring({ frame: frame - fr(LEAD + at - 0.08), fps, config: { damping: 13, stiffness: 170, mass: 0.7 } });
        return (
          <React.Fragment key={tile.name}>
            <div style={{ position: "absolute", left: x, top: y, width: size, height: size + 64, borderRadius: 16, background: "rgba(80,60,30,.12)",
              boxShadow: "inset 0 4px 10px rgba(60,40,20,.2)" }} />
            <div style={{ position: "absolute", left: x, top: y, width: size, height: size + 64, borderRadius: 16, background: "#fbf8f2",
              boxShadow: "0 18px 36px rgba(40,30,20,.28)", opacity: k > 0.01 ? 1 : 0,
              transform: `translateY(${(1 - k) * -420}px) rotate(${(1 - k) * (i % 2 ? 14 : -14)}deg) scale(${1 + (1 - k) * 0.15})` }}>
              <div style={{ position: "absolute", left: 38, top: 34, width: size - 76, height: size - 76, borderRadius: 32, background: tile.color,
                padding: tile.name === "Slack" ? 26 : 42, boxShadow: "inset 0 0 0 2px rgba(0,0,0,.08)" }}>{tile.icon}</div>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 22, textAlign: "center", fontFamily: F.grot, fontWeight: 900, fontSize: 44, color: C.ink }}>{tile.name}</div>
            </div>
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};

const Close: React.FC = () => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const L = useLayout();
  const k = spring({ frame: frame - 16, fps, config: { damping: 14, mass: 0.7 } });
  return (
    <AbsoluteFill>
      <Desk />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: L.capH - 40 }}>
        <Paper style={{ padding: L.vertical ? "60px 40px" : "70px 90px", transform: "rotate(1deg)" }}>
          <Wordmark sub="Safe invoicing for Hermes Agent" extra={
            <div style={{ marginTop: 30, display: "inline-block", fontFamily: F.mono, fontWeight: 700, fontSize: L.vertical ? 40 : 48, color: "#fbf8f2", background: C.ink,
              padding: "16px 26px", borderRadius: 12, opacity: k, transform: `translateY(${(1 - k) * 30}px)` }}>hermes plugins install ueddy/obol</div>} />
        </Paper>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- captions, page turns, assembly ---------- */

const Caption: React.FC<{ scene: VoScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const L = useLayout();
  const t = frame / FPS - LEAD;
  const card = scene.cards.find((c) => t >= c.start - 0.04 && t < c.end + 0.05);
  if (!card) return null;
  const k = interpolate(t - card.start, [-0.04, 0.12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: L.vertical ? 56 : 26, height: L.capH - (L.vertical ? 76 : 40), display: "flex",
      alignItems: "flex-end", justifyContent: "center", padding: "0 34px", opacity: Math.min(1, k * 1.5), transform: `translateY(${(1 - k) * 12}px)` }}>
      <div style={{ maxWidth: L.vertical ? 1010 : 1760, padding: "14px 30px 16px", borderRadius: 14, background: "rgba(21,19,17,0.93)", color: "#fbf8f2",
        fontFamily: F.grot, fontWeight: 800, fontSize: L.vertical ? 58 : 62, lineHeight: 1.1, letterSpacing: "-0.015em", textAlign: "center" }}>{card.text}</div>
    </div>
  );
};

/* A sheet of paper sweeps across at each scene change, like turning a page. */
const PageTurn: React.FC = () => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, fr(0.5)], [0, 1], { extrapolateRight: "clamp", easing: Easing.bezier(0.6, 0, 0.4, 1) });
  const x = 110 - p * 230;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ transform: `translateX(${x}%) skewX(-10deg)`, width: "115%", background: "linear-gradient(90deg, #cfc4b0 0%, #f6f0e4 6%, #fbf7ef 50%, #efe6d6 94%, #b8ac96 100%)",
        boxShadow: "0 0 60px rgba(40,30,20,.35)" }} />
    </AbsoluteFill>
  );
};

const SceneView: React.FC<{ def: SceneDef; vo: VoScene }> = ({ def, vo: v }) => {
  const len = fr(v.end - v.start);
  return (
    <AbsoluteFill>
      {def.kind === "logo" ? <Logo /> : def.kind === "close" ? <Close /> : def.kind === "tray" ? <Tray words={v.words} /> : (
        <AbsoluteFill>
          <Desk />
          {(def.shots ?? []).map((shot, i, arr) => {
            const startF = i === 0 ? 0 : Math.max(0, fr(LEAD + shot.at) - 10);
            const next = arr[i + 1];
            const endF = next ? Math.max(0, fr(LEAD + next.at) - 10) + 16 : len;
            return (
              <Sequence key={i} from={startF} durationInFrames={Math.max(1, endF - startF)} layout="none">
                <AbsoluteFill><ShotCard shot={shot} startF={startF} endF={endF} /></AbsoluteFill>
              </Sequence>
            );
          })}
        </AbsoluteFill>
      )}
      {def.chips ? <Chips chips={def.chips} /> : null}
      <Caption scene={v} />
    </AbsoluteFill>
  );
};

export const Demo: React.FC = () => (
  <AbsoluteFill style={{ background: C.paper }}>
    {VO.scenes.map((v, i) => (
      <Sequence key={i} from={fr(v.start)} durationInFrames={fr(v.end - v.start)}>
        <SceneView def={SCENES[i]} vo={v} />
      </Sequence>
    ))}
    {/* each line plays once, at its original speed, 0.3 s after its scene starts */}
    {VO.scenes.map((v, i) => (
      <Sequence key={`a${i}`} from={fr(v.start + LEAD)} durationInFrames={Math.min(fr(v.clip_len) + 1, DEMO_FRAMES - fr(v.start + LEAD))}>
        <Audio src={staticFile(v.clip)} />
      </Sequence>
    ))}
    {VO.scenes.slice(1).map((v, i) => (
      <Sequence key={`p${i}`} from={fr(v.start - 0.25)} durationInFrames={fr(0.5)}><PageTurn /></Sequence>
    ))}
  </AbsoluteFill>
);
