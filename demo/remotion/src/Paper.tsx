/**
 * Obol demo, "paper desk" cut: 70.0 s, ten scenes on a 2.5 s grid (paper.json), seen from above on a beige desk.
 *
 * Every screen is a real capture (Telegram Web through Hermes's gateway, VHS terminals, the dashboard, the PDF Obol
 * writes) mounted whole on a paper card; every flag or refusal line is text Obol produced (flags.json). The voice is
 * one ElevenLabs take cut per scene at original speed (demo/audio/build_vo_paper.py); each clip starts 0.3 s into
 * its scene, and captions follow its word times.
 */
import React from "react";
import { AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import "@fontsource/inter-tight/700.css";
import { F, FPS } from "./theme";
import paper from "../paper.json";
import tg from "../public/captures/paper/telegram.json";
import flags from "../public/captures/paper/flags.json";
import assets from "../public/captures/paper/assets.json";
import ledger from "../public/captures/paper/ledger.json";

export const PAPER_FRAMES = Math.round(paper.total * FPS);

const PINK = "#de3f87";
const RED = "#d4471f";
const INK = "#151311";
const SOFT = "#4a443d";
const MUTED = "#7a7266";
const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const INOUT = Easing.bezier(0.65, 0, 0.35, 1);
const IN = Easing.bezier(0.5, 0, 0.9, 0.5);
const GRAIN = staticFile("paper/grain.png");
const LEAD = paper.lead;

const tw = (t: number, a: number, b: number, from: number, to: number, e = OUT) =>
  interpolate(t, [a, b], [from, to], { ...CLAMP, easing: e });
const useT = () => useCurrentFrame() / FPS;
const useL = () => {
  const { width, height } = useVideoConfig();
  const v = height > width;
  return { v, W: width, H: height };
};
const pick = <T,>(v: boolean, wide: T, tall: T) => (v ? tall : wide);

// -- word times ---------------------------------------------------------------------------------
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9']/g, "");
/** Absolute time (s) of a word in a scene's voice clip. */
const wt = (scene: number, word: string, nth = 0, edge: "start" | "end" = "start") => {
  const s = paper.scenes[scene - 1];
  const hits = s.words.filter((w) => norm(w.w) === norm(word));
  const h = hits[Math.min(nth, hits.length - 1)];
  if (!h) throw new Error(`"${word}" is not in scene ${scene}`);
  return s.start + LEAD + h[edge];
};
const sceneAt = (n: number) => paper.scenes[n - 1];

// -- paper, shadows, desk -------------------------------------------------------------------------
const surface = (tone = "#fbf8f1"): React.CSSProperties => ({
  backgroundColor: tone, backgroundImage: `url(${GRAIN})`, backgroundSize: "320px", backgroundBlendMode: "multiply",
});
const shadow = (e = 0) =>
  `0 1px 1px rgba(40,28,14,0.10), 0 ${3 + 12 * e}px ${8 + 22 * e}px -${2 + 2 * e}px rgba(50,34,16,${0.2 + 0.1 * e}),` +
  ` 0 ${14 + 46 * e}px ${32 + 60 * e}px -${12 + 6 * e}px rgba(50,34,16,${0.3 + 0.1 * e})`;

const Desk: React.FC = () => (
  <AbsoluteFill style={{ background: "radial-gradient(ellipse 82% 78% at 50% 40%, #f1e9dc 0%, #e3d7c4 58%, #cdbea5 100%)" }}>
    <AbsoluteFill style={{ backgroundImage: `url(${GRAIN})`, backgroundSize: "400px", mixBlendMode: "multiply" }} />
    <AbsoluteFill style={{ background: "radial-gradient(ellipse 115% 100% at 50% 42%, rgba(0,0,0,0) 56%, rgba(52,34,14,0.28) 100%)" }} />
  </AbsoluteFill>
);

const InkDefs: React.FC = () => (
  <svg width="0" height="0" style={{ position: "absolute" }}>
    <filter id="ink" x="-5%" y="-10%" width="110%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" result="n" />
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -6 3.75" result="speck" />
      <feComposite in="SourceGraphic" in2="speck" operator="in" result="inked" />
      <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="9" result="w" />
      <feDisplacementMap in="inked" in2="w" scale="3.5" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>
);

/** Something placed on the desk: centred at (x, y), rotated, scaled, lifted (elevation e drives the shadow). */
const At: React.FC<{ x: number; y: number; r?: number; s?: number; o?: number; z?: number; children: React.ReactNode }> = ({ x, y, r = 0, s = 1, o = 1, z = 1, children }) => (
  <div style={{ position: "absolute", left: x, top: y, zIndex: z, opacity: o, transform: `translate(-50%, -50%) rotate(${r}deg) scale(${s})` }}>
    {children}
  </div>
);

const Card: React.FC<{ w: number; h: number; e?: number; ruled?: boolean; pad?: number; tone?: string; children?: React.ReactNode; style?: React.CSSProperties }> = ({ w, h, e = 0, ruled, pad = 0, tone, children, style }) => {
  const top = Math.round(Math.min(110, h * 0.2));
  return (
    <div style={{ width: w, height: h, borderRadius: 5, boxShadow: shadow(e), position: "relative", overflow: "hidden", ...surface(tone), ...style }}>
      {ruled ? (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: top + 2, bottom: 0, backgroundImage: "repeating-linear-gradient(to bottom, transparent 0 40px, rgba(92,132,200,0.26) 40px 42px)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, top, height: 2, background: "rgba(214,72,72,0.5)" }} />
        </>
      ) : null}
      <div style={{ position: "absolute", inset: pad }}>{children}</div>
    </div>
  );
};

/** Entry from off-frame (ease-out) and exit (ease-in); returns offsets and elevation. */
const move = (t: number, enter: [number, number, number, number?], leave?: [number, number, number, number?], dur = 0.62) => {
  const ki = tw(t, enter[0], enter[0] + dur, 0, 1, OUT);
  const ko = leave ? tw(t, leave[0], leave[0] + 0.5, 0, 1, IN) : 0;
  return {
    dx: enter[1] * (1 - ki) + (leave ? leave[1] * ko : 0),
    dy: enter[2] * (1 - ki) + (leave ? leave[2] * ko : 0),
    dr: (enter[3] ?? 0) * (1 - ki) + (leave ? (leave[3] ?? 0) * ko : 0),
    e: Math.max(1 - ki, ko),
    on: t >= enter[0] - 0.02 && (!leave || ko < 1),
  };
};

// -- rubber stamp ----------------------------------------------------------------------------------
const Stamp: React.FC<{ text: string; at: number; color?: string; size?: number; rot?: number }> = ({ text, at, color = PINK, size = 64, rot = -8 }) => {
  const t = useT() - at;
  if (t < -0.3) return null;
  const pressed = t >= 0;
  const down = tw(t, -0.3, 0, 0, 1, IN);
  const lift = tw(t, 0.07, 0.42, 0, 1, OUT);
  const inkO = pressed ? tw(t, 0, 0.05, 0, 0.94) : 0;
  const inkS = pressed ? tw(t, 0, 0.14, 1.06, 1) : 1;
  const blockS = !pressed ? 1.5 - 0.5 * down : t < 0.07 ? 0.97 : 0.97 + 0.55 * lift;
  const blockO = !pressed ? tw(t, -0.3, -0.2, 0, 1) : 1 - tw(t, 0.2, 0.42, 0, 1);
  const blockY = pressed ? -240 * lift : -30 * (1 - down);
  return (
    <div style={{ position: "relative", transform: `rotate(${rot}deg)` }}>
      <div style={{ opacity: inkO, transform: `scale(${inkS})`, mixBlendMode: "multiply" }}>
        <div style={{ filter: "url(#ink)", color, border: `${Math.round(size * 0.09)}px solid ${color}`, borderRadius: size * 0.16,
          padding: `${size * 0.14}px ${size * 0.3}px ${size * 0.1}px`, fontFamily: F.grot, fontWeight: 900, fontSize: size,
          letterSpacing: "0.03em", lineHeight: 1, whiteSpace: "nowrap", textTransform: "uppercase",
          outline: `${Math.max(2, Math.round(size * 0.035))}px solid ${color}`, outlineOffset: -Math.round(size * 0.2) }}>
          {text}
        </div>
      </div>
      {blockO > 0.01 ? (
        <div style={{ position: "absolute", inset: -size * 0.22, opacity: blockO, transform: `translateY(${blockY}px) scale(${blockS})`,
          borderRadius: size * 0.2, background: "linear-gradient(160deg, #a4744b, #6d4426 72%)",
          boxShadow: `0 ${8 + 70 * (blockS - 0.97)}px ${20 + 90 * (blockS - 0.97)}px rgba(40,20,5,0.42), inset 0 0 0 ${Math.round(size * 0.07)}px ${color}`,
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: size * 1.05, height: size * 1.05, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #cf9a6c, #7b4d2b 72%)", boxShadow: "0 5px 12px rgba(30,15,5,0.45)" }} />
        </div>
      ) : null}
    </div>
  );
};

// -- typed text (fills in like ink) -----------------------------------------------------------------
const Typed: React.FC<{ text: string; at: number; dur?: number; style?: React.CSSProperties }> = ({ text, at, dur, style }) => {
  const t = useT();
  const d = dur ?? Math.min(0.55, 0.025 * text.length + 0.12);
  const n = Math.round(tw(t, at, at + d, 0, text.length, Easing.linear));
  return (
    <div style={{ position: "relative", ...style }}>
      <span style={{ visibility: "hidden" }}>{text}</span>
      <span style={{ position: "absolute", left: 0, top: 0, whiteSpace: "pre" }}>{text.slice(0, n)}</span>
    </div>
  );
};

// -- phone screens (Telegram) -----------------------------------------------------------------------
type TgName = keyof typeof tg;
type Box = { x: number; y: number; w: number; h: number; out?: boolean };
const B = 14;   // paper border around a mounted screen
const TG_W = 860;
const TG_H = 1864;
type Push = { a: number; b: number; s: number; fx: number; fy: number };
const pushState = (t: number, keys: Push[], fx0: number, fy0: number) => {
  let s = 1;
  let fx = fx0;
  let fy = fy0;
  for (const k of keys) {
    const p = tw(t, k.a, k.b, 0, 1, INOUT);
    s += (k.s - s) * p;
    fx += (k.fx - fx) * p;
    fy += (k.fy - fy) * p;
  }
  return { s, fx, fy };
};
const boxes = (name: TgName, key: string): Box[] => ((tg[name] as { boxes: Record<string, Box[]> }).boxes[key] ?? []);
const lastBubble = (name: TgName, out = false): Box => {   // the lowest message of that side (Hermes's last reply)
  const all = boxes(name, "bubbles").filter((b) => !!b.out === out).sort((a, b) => a.y + a.h - (b.y + b.h));
  return all[all.length - 1] ?? { x: 0, y: 600, w: 860, h: 600 };
};

/** The payment page's address, shown as its link text "Pay invoice" (no provider domain on screen). */
const PayLink: React.FC<{ name: TgName; k: number; o?: number }> = ({ name, k, o = 1 }) => {
  const rects = boxes(name, "link");
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r.x)) - 4;
  const y0 = rects[0].y - 2;
  const x1 = Math.max(...rects.map((r) => r.x + r.w)) + 6;
  const y1 = Math.max(...rects.map((r) => r.y + r.h)) + 2;
  return (
    <div style={{ position: "absolute", left: x0 * k, top: y0 * k, width: (x1 - x0) * k, height: (y1 - y0) * k, background: "#ffffff", opacity: o }}>
      <span style={{ position: "absolute", left: 4 * k, top: 0, fontFamily: "Roboto, -apple-system, 'Segoe UI', Arial, sans-serif", fontSize: 32 * k, lineHeight: `${rects[0].h * k}px`, color: "#3390ec", textDecoration: "underline" }}>Pay invoice</span>
    </div>
  );
};
const firstBox = (name: TgName, key: string, fallback: Box): Box => boxes(name, key)[0] ?? fallback;
const centre = (b: Box) => ({ fx: b.x + b.w / 2, fy: b.y + b.h / 2 });

const Phone: React.FC<{ src: string; h: number; e?: number; push?: { s: number; fx: number; fy: number }; children?: (k: number) => React.ReactNode; over?: { src: string; o: number } }> = ({ src, h, e = 0, push, children, over }) => {
  const k = h / TG_H;
  const w = TG_W * k;
  const p = push ?? { s: 1, fx: TG_W / 2, fy: TG_H / 2 };
  return (
    <div style={{ padding: B, borderRadius: 7, boxShadow: shadow(e), ...surface(), transformOrigin: `${B + p.fx * k}px ${B + p.fy * k}px`, transform: `scale(${p.s})` }}>
      <div style={{ position: "relative", width: w, height: h }}>
        <Img src={staticFile(src)} style={{ width: w, height: h, display: "block", borderRadius: 4, boxShadow: "0 0 0 1px rgba(30,20,10,0.10)" }} />
        {over ? <Img src={staticFile(over.src)} style={{ position: "absolute", inset: 0, width: w, height: h, borderRadius: 4, opacity: over.o }} /> : null}
        {children ? children(k) : null}
      </div>
    </div>
  );
};
const tgSrc = (name: string) => `captures/paper/tg_${name}.png`;

/** A hand-drawn red line under one or more text boxes (image px), drawn left to right from `at`. */
const Underline: React.FC<{ rects: Box[]; k: number; at: number; color?: string }> = ({ rects, k, at, color = RED }) => {
  const t = useT();
  const total = rects.reduce((a, r) => a + r.w, 0) || 1;
  let done = tw(t, at, at + 0.45, 0, 1, Easing.linear) * total;
  return (
    <>
      {rects.map((r, i) => {
        const len = Math.max(0, Math.min(r.w, done));
        done -= r.w;
        return <div key={i} style={{ position: "absolute", left: r.x * k - 2, top: (r.y + r.h) * k - 1, width: len * k + 4, height: Math.max(3, 5 * k * 2), background: color, borderRadius: 3, opacity: 0.92, transform: "rotate(-0.6deg)" }} />;
      })}
    </>
  );
};

/** A red hand-drawn ellipse around a box, drawn over 0.4 s from `at`. */
const Circle: React.FC<{ x: number; y: number; w: number; h: number; at: number; color?: string; stroke?: number }> = ({ x, y, w, h, at, color = RED, stroke = 5 }) => {
  const t = useT();
  const p = tw(t, at, at + 0.42, 0, 1, Easing.inOut(Easing.quad));
  const rx = w / 2 + 12;
  const ry = h / 2 + 10;
  return (
    <svg style={{ position: "absolute", left: x - rx - stroke, top: y - ry - stroke, overflow: "visible" }} width={2 * (rx + stroke)} height={2 * (ry + stroke)}>
      <ellipse cx={rx + stroke} cy={ry + stroke} rx={rx} ry={ry} transform={`rotate(-6 ${rx + stroke} ${ry + stroke})`} pathLength={1}
        fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={1.06} strokeDashoffset={1.06 * (1 - p)} opacity={0.9} />
    </svg>
  );
};

/** A magnifying glass resting on a real capture: (tx, ty) in image px; w x h is the image's displayed size. */
const Loupe: React.FC<{ src: string; imgW: number; w: number; h: number; tx: number; ty: number; zoom: number; r: number; at: number; until: number }> = ({ src, imgW, w, h, tx, ty, zoom, r: R, at, until }) => {
  const t = useT();
  if (t < at - 0.05 || t > until + 0.5) return null;
  const k = w / imgW;
  const kin = tw(t, at, at + 0.55, 0, 1, OUT);
  const kout = tw(t, until, until + 0.45, 0, 1, IN);
  const dx = 260 * (1 - kin) + 320 * kout;
  const dy = 220 * (1 - kin) + 260 * kout;
  const s = 1.15 - 0.15 * kin;
  const cx = tx * k;
  const cy = ty * k;
  return (
    <div style={{ position: "absolute", left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, zIndex: 9, transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: Math.min(1, kin * 3) * (1 - kout) }}>
      <div style={{ position: "absolute", left: R * 1.55, top: R * 1.55, width: R * 0.28, height: R * 1.05, borderRadius: R * 0.1, background: "linear-gradient(90deg, #2a1d14, #5b3c27 45%, #2a1d14)", transform: "rotate(-45deg)", transformOrigin: "50% 0", boxShadow: "6px 10px 18px rgba(30,18,6,0.4)" }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden", background: "#fff", boxShadow: `0 ${18 + 30 * (s - 1)}px 40px rgba(30,18,6,0.42), 0 0 0 ${Math.round(R * 0.07)}px #2f2b27, 0 0 0 ${Math.round(R * 0.09)}px #8b8378` }}>
        <Img src={staticFile(src)} style={{ position: "absolute", width: w * zoom, height: h * zoom, left: R - cx * zoom, top: R - cy * zoom, maxWidth: "none" }} />
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle at 32% 26%, rgba(255,255,255,0.45), rgba(255,255,255,0) 38%), radial-gradient(circle, rgba(0,0,0,0) 72%, rgba(40,30,20,0.18) 100%)" }} />
      </div>
    </div>
  );
};

// -- layout per orientation ---------------------------------------------------------------------------
const phoneH = (v: boolean) => pick(v, 860, 1084);
const phoneX = (v: boolean) => pick(v, 560, 304);
const phoneY = (v: boolean) => pick(v, 462, 598);

// ==================================================================================================
// Scene 1 (0-5): an index card slides on, OBOL. prints onto it, "SAFE INVOICING" is stamped.
const S1: React.FC = () => {
  const t = useT();
  const { v, W, H } = useL();
  if (t > 5.6) return null;
  const w = pick(v, 1130, 940);
  const h = pick(v, 610, 660);
  const m = move(t, [0.02, -W * 0.8, H * 0.5, -18], [4.82, -W * 1.05, -H * 0.1, -8], 0.78);
  const push = 1 + 0.07 * tw(t, 0.9, 5, 0, 1, INOUT);
  const print = 0.86;
  return (
    <At x={W / 2 + m.dx} y={pick(v, 455, 585) + m.dy} r={-2 + m.dr} s={push}>
      <Card w={w} h={h} e={m.e} ruled pad={pick(v, 70, 64)}>
        <div style={{ display: "flex", fontFamily: F.grot, fontWeight: 900, fontSize: pick(v, 236, 214), letterSpacing: "-0.055em", lineHeight: 0.86, color: INK, marginTop: pick(v, -6, 0) }}>
          {"OBOL.".split("").map((ch, i) => {
            const a = print + i * 0.075;
            const o = tw(t, a, a + 0.09, 0, 1);
            return <span key={i} style={{ display: "inline-block", opacity: o, filter: `blur(${(1 - o) * 7}px)`, transform: `scale(${1.14 - 0.14 * o})` }}>{ch}</span>;
          })}
        </div>
        <Typed text="Invoicing for Hermes Agent" at={wt(1, "invoicing")} style={{ fontFamily: F.grot, fontWeight: 800, fontSize: pick(v, 54, 50), color: SOFT, marginTop: pick(v, 34, 30), letterSpacing: "-0.01em" }} />
        <div style={{ position: "absolute", right: pick(v, 10, 0), bottom: pick(v, 22, 40) }}>
          <Stamp text="Safe invoicing" at={wt(1, "built") + 0.06} size={pick(v, 58, 56)} rot={-7} />
        </div>
      </Card>
    </At>
  );
};

// -- the invoice card that travels through scenes 2-5 ------------------------------------------------
const INV = {
  client: "Acme Studio",
  email: "billing@acmestudio.example.com",
  lines: [["Build", "$2,000.00"], ["Revisions", "$350.00"]] as [string, string][],   // the real invoice, AKLIDBHW-0005
  total: "$2,350.00",
  due: "Due 20 Nov 2026 · 14 days",
};

const InvoiceFront: React.FC<{ v: boolean; w: number; h: number }> = ({ v, w, h }) => {
  const t = useT();
  const fs = pick(v, 30, 27);
  const label: React.CSSProperties = { fontFamily: F.grot, fontWeight: 800, fontSize: pick(v, 19, 18), letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED };
  const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", fontFamily: F.grot, fontWeight: 600, fontSize: fs, color: INK };
  const link = tw(t, wt(4, "payment") - 0.05, wt(4, "payment") + 0.3, 0, 1);
  return (
    <div style={{ position: "absolute", inset: 0, padding: pick(v, "44px 48px", "36px 36px"), display: "flex", flexDirection: "column", gap: pick(v, 16, 14) }}>
      <div style={{ display: "flex", flexDirection: v ? "column" : "row", justifyContent: "space-between", alignItems: v ? "flex-start" : "baseline", gap: v ? 4 : 0 }}>
        <div style={{ fontFamily: F.grot, fontWeight: 900, fontSize: pick(v, 58, 52), letterSpacing: "-0.04em", color: INK }}>INVOICE</div>
        <div style={label}>Drafted by Hermes</div>
      </div>
      <div style={{ height: 2, background: "rgba(21,19,17,0.5)" }} />
      <div style={label}>Bill to</div>
      <Typed text={INV.client} at={wt(2, "who")} style={{ ...row, fontWeight: 800 }} />
      <Typed text={INV.email} at={wt(2, "who") + 0.18} style={{ ...row, fontWeight: 500, fontSize: fs * 0.82, color: SOFT, marginTop: -8 }} />
      <div style={{ height: 1, background: "rgba(21,19,17,0.2)", marginTop: 6 }} />
      {INV.lines.map(([d, a], i) => (
        <div key={i} style={row}>
          <Typed text={d} at={wt(2, "what") + i * 0.22} />
          <Typed text={a} at={wt(2, "what") + 0.12 + i * 0.22} />
        </div>
      ))}
      <div style={{ height: 2, background: "rgba(21,19,17,0.5)" }} />
      <div style={{ ...row, fontWeight: 900, fontSize: fs * 1.32 }}>
        <Typed text="Total" at={wt(2, "how")} />
        <Typed text={INV.total} at={wt(2, "how") + 0.1} />
      </div>
      <Typed text={INV.due} at={wt(2, "when")} style={{ ...row, fontWeight: 600, fontSize: fs * 0.86, color: SOFT }} />
      <div style={{ marginTop: "auto", opacity: link, transform: `translateY(${(1 - link) * 12}px)`, display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ ...label, letterSpacing: "0.08em" }}>Payment link</div>
        <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: fs * 1.05, color: "#2a62c9", textDecoration: "underline", textUnderlineOffset: 6 }}>Pay invoice ↗</div>
      </div>
    </div>
  );
};

const Invoice: React.FC = () => {
  const t = useT();
  const { v, W, H } = useL();
  const born = wt(2, "who") - 0.32;
  if (t < born || t > 33.2) return null;
  // Card size: invoice card, then (from the flip) an A4 sheet.
  const flipA = wt(4, "or") - 0.08;
  const flipB = flipA + 0.62;
  const flip = tw(t, flipA, flipB, 0, 1, INOUT);
  const pdfH = pick(v, 880, 1060);
  const pdfW = pdfH * (assets.pdf[0] / assets.pdf[1]);
  const cw = pick(v, 600, 476);
  const ch = pick(v, 680, 640);
  const w = cw + (pdfW - cw) * flip;
  const h = ch + (pdfH - ch) * flip;
  // Position keyframes.
  const out = tw(t, born, born + 0.62, 0, 1);                                     // slides out from behind the phone
  const rightX = pick(v, 1335, 812);
  const rightY = pick(v, 468, 600);
  let x = phoneX(v) + (rightX - phoneX(v)) * out;
  let y = phoneY(v) + (rightY - phoneY(v)) * out;
  let r = 3 - 4.5 * out;
  const toCentre = tw(t, sceneAt(4).start - 0.05, sceneAt(4).start + 0.55, 0, 1, INOUT);  // scene 4: centre stage
  x += (W / 2 - x) * toCentre;
  y += (pick(v, 462, 585) - y) * toCentre;
  r += (-r - 0.6) * toCentre;
  const aside = tw(t, sceneAt(5).start + 0.55, sceneAt(5).start + 1.15, 0, 1, INOUT);    // scene 5: moves aside for the chat
  x += (pick(v, 1400, 812) - x) * aside;
  y += (pick(v, 470, 600) - y) * aside;
  const sAside = 1 - pick(v, 0.12, 0.3) * aside;
  const exit = tw(t, sceneAt(5).end - 0.2, sceneAt(5).end + 0.4, 0, 1, IN);
  x += W * 0.75 * exit;
  r += 8 * exit;
  // Push in on the bank details after the flip (scene 4), back out before the stamp.
  const pushIn = tw(t, flipB + 0.15, flipB + 0.85, 0, 1, INOUT) * (1 - tw(t, sceneAt(5).start - 0.3, sceneAt(5).start + 0.15, 0, 1, INOUT));
  const ps = 1 + pick(v, 0.26, 0.2) * pushIn;
  const fy = h * (1040 / 2339);
  const e = Math.max(1 - out, exit, flip * (1 - flip) * 2.2, toCentre * (1 - toCentre) * 2);
  return (
    <At x={x} y={y} r={r} s={sAside} z={6}>
      <div style={{ transformOrigin: `${w / 2}px ${fy}px`, transform: `scale(${ps})` }}>
        <div style={{ width: w, height: h, perspective: 2200, position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d", transform: `rotateY(${-180 * flip}deg)` }}>
            <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden" }}>
              <Card w={w} h={h} e={e}>{flip < 0.5 ? <InvoiceFront v={v} w={w} h={h} /> : null}</Card>
              <div style={{ position: "absolute", right: pick(v, 22, 20), ...(v ? { bottom: 92 } : { top: 26 }) }}>
                <Stamp text="Approved" at={wt(3, "single") - 0.05} size={pick(v, 56, 46)} rot={-7} />
              </div>
            </div>
            <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
              <div style={{ width: w, height: h, boxShadow: shadow(e), borderRadius: 2, overflow: "hidden", background: "#fff" }}>
                <Img src={staticFile("captures/paper/bank-invoice.png")} style={{ width: w, height: h, display: "block" }} />
                {flip > 0.99 ? <Loupe src="captures/paper/bank-invoice.png" imgW={assets.pdf[0]} w={w} h={h} tx={380} ty={1040} zoom={pick(v, 2.5, 2.2)} r={pick(v, 235, 240)} at={flipB + 0.3} until={sceneAt(5).start - 0.35} /> : null}
                <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${GRAIN})`, backgroundSize: "320px", mixBlendMode: "multiply", opacity: 0.55 }} />
              </div>
              <div style={{ position: "absolute", right: pick(v, 46, 40), top: pick(v, 250, 300) }}>
                <Stamp text="Paid" at={sceneAt(5).start + 0.22} size={pick(v, 96, 88)} rot={-12} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </At>
  );
};

// Scene 2 (5-15): the Telegram draft; push in on Hermes's draft, then the invoice card slides out of it.
const S2: React.FC = () => {
  const t = useT();
  const { v, W } = useL();
  if (t < 4.8 || t > 15.8) return null;
  const m = move(t, [5.0, W * 0.7, 40, 9], [15.0, -W * 0.75, 30, -10]);
  const draft = centre(lastBubble("draft"));
  const push = pushState(t, [
    { a: wt(2, "forward") - 0.1, b: wt(2, "drafts") + 0.2, s: pick(v, 1.25, 1.3), ...draft },
    { a: wt(2, "who") - 0.35, b: wt(2, "who") + 0.3, s: 1, ...draft },
  ], draft.fx, draft.fy);
  return (
    <At x={phoneX(v) + m.dx} y={phoneY(v) + m.dy} r={-1.2 + m.dr} z={4}>
      <Phone src={tgSrc("draft")} h={phoneH(v)} e={m.e} push={push} />
    </At>
  );
};

// Scene 3 (15-22.5): the approval prompt, the tap, APPROVED lands on the invoice.
const S3: React.FC = () => {
  const t = useT();
  const { v, W } = useL();
  if (t < 14.8 || t > 23.2) return null;
  const m = move(t, [15.0, W * 0.7, -30, 8], [22.45, -W * 0.75, 20, -9]);
  const btn = firstBox("approval", "button:Allow Once", { x: 60, y: 1700, w: 360, h: 80 });
  const tap = wt(3, "approval") + 0.25;
  const swap = tw(t, tap + 0.12, tap + 0.3, 0, 1);
  const ripple = tw(t, tap, tap + 0.45, 0, 1, OUT);
  const push = pushState(t, [
    { a: 15.7, b: 16.6, s: pick(v, 1.14, 1.3), ...centre(btn) },
    { a: tap + 0.5, b: tap + 1.3, s: 1, ...centre(btn) },
  ], centre(btn).fx, centre(btn).fy);
  return (
    <At x={phoneX(v) + m.dx} y={phoneY(v) + m.dy} r={1 + m.dr} z={5}>
      <Phone src={tgSrc("approval")} over={{ src: tgSrc("approved"), o: swap }} h={phoneH(v)} e={m.e} push={push}>
        {(k) => (<>
          <PayLink name="approved" k={k} o={swap} />
          {t > tap && ripple < 1 ? (
          <div style={{ position: "absolute", left: (btn.x + btn.w / 2) * k, top: (btn.y + btn.h / 2) * k, width: 0, height: 0 }}>
            <div style={{ position: "absolute", left: -90 * ripple, top: -90 * ripple, width: 180 * ripple, height: 180 * ripple, borderRadius: "50%", background: PINK, opacity: 0.45 * (1 - ripple) }} />
          </div>) : null}
        </>)}
      </Phone>
    </At>
  );
};

// Scene 5 (27.5-32.5): "Have they paid?" and Hermes's real answer.
const S5: React.FC = () => {
  const t = useT();
  const { v, W } = useL();
  if (t < 27.9 || t > 33.2) return null;
  const m = move(t, [28.05, -W * 0.7, 40, -9], [32.45, -W * 0.75, -20, -8]);
  const ans = centre(lastBubble("paid"));
  const push = pushState(t, [{ a: wt(5, "checks") - 0.3, b: wt(5, "you") + 0.3, s: pick(v, 1.22, 1.3), ...ans }], ans.fx, ans.fy);
  return (
    <At x={phoneX(v) + m.dx} y={phoneY(v) + m.dy} r={-1 + m.dr} z={7}>
      <Phone src={tgSrc("paid")} h={phoneH(v)} e={m.e} push={push} />
    </At>
  );
};

// Scene 6 (32.5-37.5): five index tabs fan out, one per surface as it is named.
const TABS: { label: string; word: string; screen?: { src: string; w: number; h: number } }[] = [
  { label: "Telegram", word: "telegram", screen: { src: tgSrc("paid"), w: TG_W, h: TG_H } },
  { label: "WhatsApp", word: "whatsapp" },
  { label: "Slack", word: "slack" },
  { label: "Email", word: "email" },
  { label: "Terminal", word: "terminal", screen: { src: "captures/paper/term_tab.png", w: assets.term_tab[0], h: assets.term_tab[1] } },
];
const S6: React.FC = () => {
  const t = useT();
  const { v, W, H } = useL();
  const s6 = sceneAt(6);
  if (t < s6.start - 0.2 || t > s6.end + 0.7) return null;
  const cw = pick(v, 336, 318);
  const ch = pick(v, 470, 480);
  const tabH = pick(v, 58, 56);
  const enter = tw(t, s6.start, s6.start + 0.55, 0, 1);
  const exit = tw(t, s6.end - 0.2, s6.end + 0.45, 0, 1, IN);
  const slots = v
    ? [[200, 360], [540, 360], [880, 360], [370, 890], [710, 890]]
    : [[960 - 2 * 362, 470], [960 - 362, 470], [960, 470], [960 + 362, 470], [960 + 2 * 362, 470]];
  const stack = { x: W / 2, y: pick(v, 540, 640) };
  return (
    <AbsoluteFill style={{ transform: `translateY(${(1 - enter) * H * 0.7 - exit * H * 0.9}px)` }}>
      {TABS.map((tab, i) => {
        const a = wt(6, tab.word) - 0.12;
        const k = tw(t, a, a + 0.5, 0, 1, OUT);
        const [sx, sy] = slots[i];
        const x = stack.x + (sx - stack.x) * k + (1 - k) * (i - 2) * 6;
        const y = stack.y + (sy - stack.y) * k + (1 - k) * i * -5;
        const r = (1 - k) * (i - 2) * 3 + k * (v ? (i % 2 ? 2 : -2) : (i - 2) * 1.6);
        const img = tab.screen;
        const boxH = ch - tabH - 46;
        const boxW = cw - 36;
        const fit = img ? Math.min(boxH / img.h, boxW / img.w) : 1;
        return (
          <At key={tab.label} x={x} y={y} r={r} z={10 + (k > 0.01 ? 10 + i : 5 - i)}>
            <div style={{ position: "relative", paddingTop: tabH - 6 }}>
              <div style={{ position: "absolute", left: 18, top: 0, height: tabH, padding: "0 22px", borderRadius: "10px 10px 0 0", display: "flex", alignItems: "center",
                fontFamily: F.grot, fontWeight: 800, fontSize: pick(v, 30, 29), color: k > 0.5 ? "#fff" : INK, background: k > 0.5 ? PINK : "#efe6d6", boxShadow: shadow(0), ...(k > 0.5 ? {} : surface("#efe6d6")) }}>
                {tab.label}
              </div>
              <Card w={cw} h={ch - tabH + 6} e={Math.max(1 - enter, k * (1 - k) * 2)}>
                {img ? (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Img src={staticFile(img.src)} style={{ width: img.w * fit, height: img.h * fit, borderRadius: 4, boxShadow: "0 0 0 1px rgba(30,20,10,0.12), 0 3px 8px rgba(40,28,14,0.18)" }} />
                  </div>
                ) : (
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
                    <div style={{ fontFamily: F.grot, fontWeight: 900, fontSize: pick(v, 44, 42), letterSpacing: "-0.03em", color: INK }}>{tab.label}</div>
                    <div style={{ width: "62%", height: 2, background: "rgba(21,19,17,0.25)" }} />
                    <div style={{ fontFamily: F.grot, fontWeight: 700, fontSize: pick(v, 22, 21), color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase" }}>Same approvals</div>
                  </div>
                )}
              </Card>
            </div>
          </At>
        );
      })}
    </AbsoluteFill>
  );
};

// Scene 7 (37.5-50): the scam message; the changed letter circled, the injected order underlined, BLOCKED, three flags.
const MONO = '"Courier Prime", "Courier New", monospace';
const Compare: React.FC<{ v: boolean; at: number }> = ({ v, at }) => {
  const fs = pick(v, 40, 31);
  const cwid = fs * 0.6;
  const real = flags.real_email.split("@")[1];
  const fake = flags.fake_email.split("@")[1];
  // first differing position
  let d = 0;
  while (d < real.length && real[d] === fake[d]) d++;
  const lab: React.CSSProperties = { fontFamily: F.grot, fontWeight: 800, fontSize: pick(v, 19, 17), letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED, marginBottom: 4 };
  const line = (label: string, dom: string, n: number, color: string) => (
    <div style={{ position: "relative" }}>
      <div style={lab}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: fs, color, whiteSpace: "nowrap", position: "relative" }}>
        {v ? null : <span style={{ fontSize: fs * 0.7, color: MUTED }}>billing@</span>}
        <span>{dom.slice(0, d)}</span>
        <span style={{ position: "relative", display: "inline-block" }}>{dom.slice(d, d + n)}
          <span style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0 }}>
            <Circle x={cwid * 0.25} y={0} w={n * cwid - 10} h={fs * 0.7} at={at + (color === RED ? 0.18 : 0)} stroke={v ? 4 : 5} />
          </span>
        </span>
        <span>{dom.slice(d + n)}</span>
      </div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: pick(v, 18, 14) }}>
      {line("Your client", real, 1, INK)}
      {line("The scam", fake, 2, RED)}
    </div>
  );
};

const FLAG_TITLES: Record<string, string> = { lookalike_domain: "Lookalike domain", impersonation: "Impersonation", prompt_injection: "Prompt injection" };
const S7: React.FC = () => {
  const t = useT();
  const { v, W, H } = useL();
  const s7 = sceneAt(7);
  if (t < s7.start - 0.2 || t > s7.end + 0.7) return null;
  const m = move(t, [s7.start, W * 0.7, -40, 8], [s7.end - 0.05, -W * 0.8, 20, -8]);
  const addr = firstBox("scam", flags.fake_email, lastBubble("scam", true));
  const skip = boxes("scam", "skip the approval step");
  const skipC = skip.length ? centre({ x: skip[0].x, y: skip[0].y, w: skip[skip.length - 1].x + skip[skip.length - 1].w - skip[0].x, h: skip[skip.length - 1].y + skip[skip.length - 1].h - skip[0].y }) : centre(addr);
  const push = pushState(t, [
    { a: wt(7, "someone") - 0.3, b: wt(7, "email") + 0.1, s: pick(v, 1.28, 1.3), ...centre(addr) },
    { a: wt(7, "tells") - 0.2, b: wt(7, "skip") - 0.05, s: pick(v, 1.28, 1.3), ...skipC },
    { a: wt(7, "flags") - 0.55, b: wt(7, "flags") + 0.1, s: 1, ...skipC },
  ], centre(addr).fx, centre(addr).fy);
  const colX = pick(v, 1385, 822);
  const colW = pick(v, 900, 470);
  const cmpIn = move(t, [wt(7, "changes") - 0.35, W * 0.5, 0, 6], [s7.end - 0.05, W * 0.6, 0, 6], 0.55);
  const scamFlags = flags.scam_flags as { check: string; short: string }[];
  const order = ["lookalike_domain", "impersonation", "prompt_injection"];
  const times = [wt(7, "lookalike"), wt(7, "impersonation"), wt(7, "injected")];
  const flagH = pick(v, 168, 228);
  const flagY = (i: number) => pick(v, 460, 552) + i * (flagH + pick(v, 16, 18));
  return (
    <>
      <At x={phoneX(v) + m.dx} y={phoneY(v) + m.dy} r={-1 + m.dr} z={4}>
        <div style={{ position: "relative" }}>
          <Phone src={tgSrc("scam")} h={phoneH(v)} e={m.e} push={push}>
            {(k) => <Underline rects={skip} k={k} at={wt(7, "skip")} />}
          </Phone>
          <div style={{ position: "absolute", left: "50%", top: pick(v, "54%", "52%"), transform: "translate(-50%, -50%)", zIndex: 3 }}>
            <Stamp text="Blocked" at={wt(7, "flags") - 0.05} size={pick(v, 86, 80)} rot={-11} />
          </div>
        </div>
      </At>
      {cmpIn.on ? (
        <At x={colX + cmpIn.dx} y={pick(v, 212, 250) + cmpIn.dy} r={0.8 + cmpIn.dr} z={6}>
          <Card w={colW} h={pick(v, 250, 290)} e={cmpIn.e} pad={pick(v, 34, 26)}>
            <Compare v={v} at={wt(7, "changes") + 0.05} />
          </Card>
        </At>
      ) : null}
      {order.map((c, i) => {
        const f = scamFlags.find((x) => x.check === c);
        const fm = move(t, [times[i] - 0.25, -colW * 0.6, 0, -4], [s7.end - 0.05, W * 0.6, 0, 6], 0.5);
        if (!f || !fm.on) return null;
        return (
          <At key={c} x={colX + fm.dx} y={flagY(i) + fm.dy} r={(i - 1) * 0.6 + fm.dr} z={7 + i}>
            <Card w={colW} h={flagH} e={fm.e} pad={pick(v, 26, 22)}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ fontFamily: F.grot, fontWeight: 900, fontSize: pick(v, 22, 19), color: "#fff", background: RED, padding: "4px 10px", borderRadius: 4, letterSpacing: "0.06em" }}>HIGH</div>
                <div style={{ fontFamily: F.grot, fontWeight: 900, fontSize: pick(v, 36, 31), color: INK, letterSpacing: "-0.02em" }}>{FLAG_TITLES[c]}</div>
              </div>
              <div style={{ fontFamily: F.grot, fontWeight: 600, fontSize: pick(v, 25, 22), color: SOFT, marginTop: 12, lineHeight: 1.25 }}>{f.short}</div>
            </Card>
          </At>
        );
      })}
    </>
  );
};

// Scene 8 (50-57.5): a sorting tray; one tab per check drops into its slot, with the real flag line it stands for.
const CHECKS = (() => {
  const tr = flags.tricks as Record<string, { technique: string; short: string }>;
  const ck = flags.checks as Record<string, { short: string }>;
  const quote = (s: string) => (s.match(/“[^”]*”/)?.[0] ?? s);
  return [
    { label: "Hidden", word: "hidden", line: `Hidden instructions (${tr.hidden.technique}): ${quote(tr.hidden.short)}` },
    { label: "Encoded", word: "encoded", line: `Instructions in ${tr.encoded.technique}: ${quote(tr.encoded.short)}` },
    { label: "Translated", word: "translated", line: `Instructions in another language: ${quote(tr.translated.short)}` },
    { label: "Duplicate", word: "duplicates", line: ck.duplicate.short },
    { label: "Unusual amount", word: "odd", line: ck.unusual_amount.short },
    { label: "Details changed", word: "contact", line: ck.contact_change.short },
    { label: "Payout changed", word: "payout", line: ck.payout_change.short },
    { label: "Fraud risk", word: "", line: ck.payment_risk.short },
    { label: "Disputes", word: "", line: ck.dispute.short },
  ];
})();
const S8: React.FC = () => {
  const t = useT();
  const { v, W, H } = useL();
  const s8 = sceneAt(8);
  if (t < s8.start - 0.2 || t > s8.end + 0.7) return null;
  const tm = move(t, [s8.start, 0, H * 0.75, 3], [s8.end + 0.12, 0, -H, -4], 0.6);
  const tw8 = pick(v, 1040, 1000);
  const th8 = pick(v, 790, 720);
  const tx = pick(v, 640, 540);
  const ty = pick(v, 462, 418);
  const sw = (tw8 - 70) / 3;
  const sh = (th8 - 70) / 3;
  const payout = wt(8, "payout");
  const at = CHECKS.map((c, i) => (c.word ? wt(8, c.word) - 0.1 : payout + 0.37 + 0.25 * (i - 7)));
  let cur = -1;
  at.forEach((a, i) => { if (t >= a + 0.25) cur = i; });
  const lineIn = cur >= 0 ? tw(t, at[cur] + 0.25, at[cur] + 0.45, 0, 1) : 0;
  const lm = move(t, [s8.start + 0.4, W * 0.5, 0, 4], [s8.end - 0.05, W * 0.6, 0, 4], 0.5);
  return (
    <>
      <At x={tx + tm.dx} y={ty + tm.dy} r={-0.8 + tm.dr} z={4}>
        <div style={{ width: tw8, height: th8, borderRadius: 14, position: "relative", ...surface("#c9a77c"), boxShadow: `${shadow(tm.e)}, inset 0 2px 0 rgba(255,255,255,0.35), inset 0 -3px 0 rgba(60,35,10,0.25)` }}>
          {CHECKS.map((c, i) => {
            const col = i % 3;
            const row = Math.floor(i / 3);
            const sx = 25 + col * (sw + 10);
            const sy = 25 + row * (sh + 10);
            const k = tw(t, at[i], at[i] + 0.34, 0, 1, Easing.bezier(0.3, 1.35, 0.5, 1));
            const shown = t >= at[i];
            return (
              <div key={c.label} style={{ position: "absolute", left: sx, top: sy, width: sw, height: sh }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: 8, ...surface("#8f6b45"), boxShadow: "inset 0 10px 18px rgba(40,22,6,0.55), inset 0 -2px 0 rgba(255,255,255,0.18)" }} />
                {shown ? (
                  <div style={{ position: "absolute", left: 12, right: 12, top: 10, bottom: sh * 0.24, transform: `translateY(${(1 - k) * -sh * 2.2}px) scale(${1 + (1 - k) * 0.22})`, opacity: tw(t, at[i], at[i] + 0.08, 0, 1) }}>
                    <Card w={sw - 24} h={sh * 0.76 - 10} e={(1 - k) * 0.9} style={{ borderTop: `${Math.round(sh * 0.07)}px solid ${i >= 7 ? INK : PINK}` }}>
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 10px",
                        fontFamily: F.grot, fontWeight: 900, fontSize: pick(v, 40, 38), letterSpacing: "-0.03em", color: INK, lineHeight: 1 }}>{c.label}</div>
                    </Card>
                  </div>
                ) : null}
                <div style={{ position: "absolute", left: -4, right: -4, bottom: -4, height: sh * 0.3, borderRadius: "0 0 9px 9px", ...surface("#c39f73"), boxShadow: "0 -3px 6px rgba(50,28,8,0.35), inset 0 2px 0 rgba(255,255,255,0.3)" }} />
              </div>
            );
          })}
        </div>
      </At>
      {lm.on ? (
        <At x={pick(v, 1515, 540) + lm.dx} y={pick(v, 470, 990) + lm.dy} r={1 + lm.dr} z={6}>
          <Card w={pick(v, 650, 960)} h={pick(v, 330, 230)} e={lm.e} pad={pick(v, 34, 28)} ruled>
            <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: pick(v, 20, 19), letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED }}>
              {cur >= 0 ? `Obol flags · ${CHECKS[cur].label}` : "Obol flags"}
            </div>
            {cur >= 0 ? (
              <div style={{ fontFamily: F.grot, fontWeight: 700, fontSize: pick(v, 31, 28), lineHeight: 1.3, color: INK, marginTop: pick(v, 40, 26), opacity: lineIn, transform: `translateY(${(1 - lineIn) * 10}px)` }}>
                {CHECKS[cur].line}
              </div>
            ) : null}
          </Card>
        </At>
      ) : null}
    </>
  );
};

// Scene 9 (57.5-65): a ledger opens on the real activity log; two stamps; an edited line is caught.
const S9: React.FC = () => {
  const t = useT();
  const { v, W, H } = useL();
  const s9 = sceneAt(9);
  if (t < s9.start - 0.2 || t > s9.end + 0.7) return null;
  const bm = move(t, [s9.start + 0.08, 0, H * 0.8, -3], [s9.end - 0.05, 0, -H * 1.05, 3], 0.55);
  const pw = pick(v, 800, 512);
  const ph = pick(v, 790, 730);
  const open = tw(t, s9.start + 0.35, s9.start + 1.05, 0, 1, INOUT);
  const rows = ledger.rows as { seq: number; time: string; kind: string; ref: string; detail: string; hash: string }[];
  const tamperIdx = rows.findIndex((r) => r.seq === ledger.tamper_seq);
  const edit = wt(9, "exposes") - 0.1;
  const caught = wt(9, "tampering") - 0.05;
  const fs = pick(v, 21, 15.5);
  const page: React.CSSProperties = { width: pw, height: ph, ...surface("#f7f1e3"), position: "relative", overflow: "hidden" };
  const rule = "repeating-linear-gradient(to bottom, transparent 0 41px, rgba(92,132,200,0.22) 41px 43px)";
  const logPage = (
    <div style={{ ...page, borderRadius: "6px 0 0 6px", boxShadow: "inset -18px 0 26px -18px rgba(60,40,15,0.45)" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: rule, backgroundPosition: `0 ${pick(v, 96, 86)}px` }} />
      <div style={{ position: "absolute", inset: pick(v, "34px 38px", "26px 22px") }}>
        <div style={{ fontFamily: F.grot, fontWeight: 900, fontSize: pick(v, 34, 26), color: INK, letterSpacing: "-0.02em" }}>Activity log</div>
        <div style={{ fontFamily: F.grot, fontWeight: 700, fontSize: pick(v, 16, 13), color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: pick(v, 18, 14) }}>Hash-chained · {ledger.source}</div>
        {rows.map((r, i) => {
          const tam = i === tamperIdx;
          const strike = tam ? tw(t, edit, edit + 0.3, 0, 1, Easing.linear) : 0;
          const hand = tam ? tw(t, edit + 0.3, edit + 0.6, 0, 1) : 0;
          return (
            <div key={r.seq} style={{ display: "flex", gap: pick(v, 12, 7), alignItems: "baseline", height: pick(v, 43, 43), fontFamily: MONO, fontSize: fs, color: INK, whiteSpace: "nowrap", position: "relative" }}>
              <span style={{ width: fs * 1.9, color: MUTED }}>#{r.seq}</span>
              <span style={{ width: fs * 3.2, color: MUTED }}>{r.time}</span>
              <span style={{ width: fs * pick(v, 6.4, 5.7), fontWeight: 700 }}>{r.kind}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", position: "relative" }}>
                {r.detail}
                {tam ? <span style={{ position: "absolute", left: 0, top: "52%", height: 3, width: `${strike * 100}%`, background: RED }} /> : null}
              </span>
              <span style={{ color: MUTED, fontSize: fs * 0.82 }}>{r.hash}</span>
              {tam && hand > 0 ? (
                <span style={{ position: "absolute", left: fs * 13.5, top: -fs * 1.05, fontFamily: F.hand, fontSize: fs * 1.55, color: "#2a4fb0", opacity: hand, transform: "rotate(-3deg)" }}>{ledger.tamper_text}</span>
              ) : null}
              {tam ? (
                <span style={{ position: "absolute", right: pick(v, -18, -14), top: -fs * 0.75, zIndex: 3 }}>
                  <Stamp text="Tampered" at={caught} color={RED} size={pick(v, 28, 20)} rot={-7} />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
  const refusal = (s: string) => s.replace(/STRIPE_API_KEY is a LIVE key/, "… is a LIVE key").replace(/ \(plugins\.entries\.obol\.settings\.allow_live\)/, "");
  const blank = (
    <div style={{ ...page, borderRadius: "0 6px 6px 0", boxShadow: "inset 18px 0 26px -18px rgba(60,40,15,0.45)" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: rule, backgroundPosition: `0 ${pick(v, 96, 86)}px` }} />
      <div style={{ position: "absolute", left: pick(v, 50, 26), right: pick(v, 40, 20), top: pick(v, 60, 40) }}>
        <Stamp text="Live keys locked" at={wt(9, "locked") - 0.05} size={pick(v, 44, 30)} rot={-4} />
        <div style={{ fontFamily: MONO, fontSize: pick(v, 19, 14), color: SOFT, marginTop: pick(v, 18, 12), lineHeight: 1.35, opacity: tw(t, wt(9, "locked") + 0.25, wt(9, "locked") + 0.5, 0, 1) }}>{refusal(flags.refusals.live_key)}</div>
      </div>
      <div style={{ position: "absolute", left: pick(v, 50, 26), right: pick(v, 40, 20), top: pick(v, 330, 300) }}>
        <Stamp text="Scheduled runs: no sends" at={wt(9, "send") - 0.05} size={pick(v, 34, 24)} rot={3} />
        <div style={{ fontFamily: MONO, fontSize: pick(v, 19, 14), color: SOFT, marginTop: pick(v, 18, 12), lineHeight: 1.35, opacity: tw(t, wt(9, "send") + 0.25, wt(9, "send") + 0.5, 0, 1) }}>{flags.refusals.scheduled_run.split(". Report")[0]}.</div>
      </div>
    </div>
  );
  const dm = move(t, [caught + 0.05, W * 0.5, 0, 4], [s9.end - 0.05, W * 0.6, 0, 4], 0.5);
  const dW = pick(v, 820, 980);
  const dH = dW * (assets.term_doctor[1] / assets.term_doctor[0]);
  return (
    <>
      <At x={W / 2 + bm.dx} y={pick(v, 462, 432) + bm.dy} r={-0.6 + bm.dr} z={4}>
        <div style={{ width: pw * 2 + 24, height: ph + 24, borderRadius: 10, ...surface("#2f4a3a"), boxShadow: shadow(bm.e), position: "relative", perspective: 3000 }}>
          <div style={{ position: "absolute", left: pw + 12, top: 12 }}>{blank}</div>
          <div style={{ position: "absolute", left: 12 + pw, top: 12, width: pw, height: ph, transformOrigin: "0 50%", transformStyle: "preserve-3d", transform: `rotateY(${-180 * open}deg)` }}>
            <div style={{ position: "absolute", inset: -12, left: 0, backfaceVisibility: "hidden", borderRadius: "0 10px 10px 0", ...surface("#2f4a3a"), boxShadow: "inset 0 0 0 3px rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ border: "2px solid rgba(240,225,190,0.6)", padding: "18px 34px", fontFamily: F.grot, fontWeight: 900, fontSize: pick(v, 44, 34), color: "rgba(240,225,190,0.85)", letterSpacing: "0.12em" }}>LEDGER</div>
            </div>
            <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>{logPage}</div>
          </div>
          <div style={{ position: "absolute", left: pw + 8, top: 6, bottom: 6, width: 8, background: "linear-gradient(90deg, rgba(0,0,0,0.25), rgba(0,0,0,0))", opacity: open }} />
        </div>
      </At>
      {dm.on ? (
        <At x={pick(v, 1440, 540) + dm.dx} y={pick(v, 700, 935) + dm.dy} r={1.2 + dm.dr} z={8}>
          <div style={{ padding: 12, borderRadius: 6, boxShadow: shadow(dm.e), ...surface() }}>
            <div style={{ position: "relative" }}>
              <Img src={staticFile("captures/paper/term_doctor.png")} style={{ width: dW, height: dH, display: "block", borderRadius: 4 }} />
              <Loupe src="captures/paper/term_doctor.png" imgW={assets.term_doctor[0]} w={dW} h={dH} tx={516} ty={233} zoom={pick(v, 2.6, 2.2)} r={pick(v, 250, 262)} at={caught + 0.45} until={s9.end - 0.3} />
            </div>
          </div>
        </At>
      ) : null}
    </>
  );
};

// Scene 10 (65-70): the dashboard on a sheet, then the closing card.
const S10: React.FC = () => {
  const t = useT();
  const { v, W, H } = useL();
  const s10 = sceneAt(10);
  if (t < s10.start - 0.2) return null;
  const sm = move(t, [s10.start, 0, H * 0.85, 4], undefined, 0.62);
  const maxW = pick(v, 1520, 1010);
  const maxH = pick(v, 860, 900);
  const k = Math.min(maxW / assets.dashboard[0], maxH / assets.dashboard[1]);
  const dw = assets.dashboard[0] * k;
  const dh = assets.dashboard[1] * k;
  const push = 1 + 0.05 * tw(t, s10.start + 0.6, 70, 0, 1, INOUT);
  const fin = wt(10, "obol") - 0.3;
  const fm = move(t, [fin, -W * 0.7, H * 0.3, -10], undefined, 0.65);
  const drift = tw(t, fin + 0.6, 70, 0, 1, Easing.linear);
  return (
    <>
      <At x={W / 2 + sm.dx} y={pick(v, 455, 520) + sm.dy} r={0.6 + sm.dr} s={push} z={4}>
        <div style={{ padding: 14, borderRadius: 6, boxShadow: shadow(sm.e), ...surface() }}>
          <Img src={staticFile("captures/paper/dashboard.png")} style={{ width: dw, height: dh, display: "block", borderRadius: 3 }} />
        </div>
      </At>
      {fm.on ? (
        <At x={W / 2 + fm.dx} y={pick(v, 450, 560) + fm.dy - 6 * drift} r={-1.5 + fm.dr + 0.5 * drift} s={1 + 0.02 * drift} z={9}>
          <Card w={pick(v, 1180, 960)} h={pick(v, 600, 690)} e={fm.e} ruled pad={pick(v, 64, 56)}>
            <div style={{ fontFamily: F.grot, fontWeight: 900, fontSize: pick(v, 220, 200), letterSpacing: "-0.055em", lineHeight: 0.86, color: INK }}>OBOL.</div>
            <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: pick(v, 58, 52), color: INK, marginTop: pick(v, 34, 30), letterSpacing: "-0.015em" }}>Safe invoicing for Hermes Agent</div>
            <div style={{ display: "inline-block", marginTop: pick(v, 40, 40), padding: "12px 22px", background: INK, color: "#f4efe6", fontFamily: MONO, fontSize: pick(v, 38, 32), borderRadius: 4, boxShadow: shadow(0) }}>
              hermes plugins install ueddy/obol
            </div>
          </Card>
        </At>
      ) : null}
    </>
  );
};

// Scene 4 has no screen of its own: the invoice card flips to the bank-transfer PDF (see Invoice).

// -- captions -------------------------------------------------------------------------------------------
const Captions: React.FC = () => {
  const t = useT();
  const { v } = useL();
  let cur: { text: string; a: number; b: number } | null = null;
  for (const s of paper.scenes) {
    for (const c of s.cards) {
      const a = s.start + LEAD + c.start;
      const b = Math.min(s.end, s.start + LEAD + c.end);
      if (t >= a && t < b) cur = { text: c.text, a, b };
    }
  }
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(38,24,8,0.42) 0%, rgba(38,24,8,0.16) 11%, rgba(38,24,8,0) 20%)" }} />
      {cur ? (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: pick(v, 40, 52) }}>
          <div style={{ maxWidth: pick(v, 1560, 980), textAlign: "center", fontFamily: F.grot, fontWeight: 700, fontSize: pick(v, 46, 48), lineHeight: 1.18,
            color: "#fff", opacity: Math.min(tw(t, cur.a, cur.a + 0.1, 0, 1), 1 - tw(t, cur.b - 0.08, cur.b, 0, 1)),
            textShadow: "0 2px 3px rgba(20,12,4,0.7), 0 0 20px rgba(20,12,4,0.5), 0 0 3px rgba(20,12,4,0.6)" }}>
            {cur.text}
          </div>
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

// -- the whole film ---------------------------------------------------------------------------------------
export const Paper: React.FC = () => {
  const t = useT();
  // A slow, constant drift of the camera over the desk, so no frame is ever still.
  const cam = `translate(${Math.sin(t * 0.37) * 5}px, ${Math.cos(t * 0.29) * 4}px) scale(${1.012 + 0.006 * Math.sin(t * 0.21)})`;
  return (
    <AbsoluteFill style={{ background: "#d9ccb6" }}>
      <InkDefs />
      <AbsoluteFill style={{ transform: cam }}>
        <Desk />
        <S1 />
        <S2 />
        <S3 />
        <Invoice />
        <S5 />
        <S6 />
        <S7 />
        <S8 />
        <S9 />
        <S10 />
      </AbsoluteFill>
      <Captions />
      {paper.scenes.map((s) => (
        <Sequence key={s.scene} from={Math.round((s.start + LEAD) * FPS)} durationInFrames={Math.round((paper.total - s.start - LEAD) * FPS)}>
          <Audio src={staticFile(s.clip)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
