import React from "react";
import { AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import captions from "../captions.json";
import dash from "../public/captures/dashboard.json";
import { C, F, FPS } from "./theme";

type Card = { text: string; start: number; end: number };
type BeatCaptions = { beat: string; duration: number | null; cards: Card[] };
const CAPS = captions as BeatCaptions[];

/* Burned-in caption: large, high-contrast, readable on a phone with the sound off. */
export const Captions: React.FC<{ beat: number; offset?: number }> = ({ beat, offset = 0.2 }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS - offset;
  const card = CAPS[beat - 1]?.cards.find((c) => t >= c.start && t < c.end + 0.15);
  if (!card) return null;
  const fadeIn = interpolate(t - card.start, [0, 0.12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 70, display: "flex", justifyContent: "center", opacity: fadeIn }}>
      <div style={{
        maxWidth: 1500, padding: "18px 34px 20px", borderRadius: 14, background: "rgba(16, 14, 12, 0.82)",
        color: "#fbf8f2", fontFamily: F.grot, fontWeight: 800, fontSize: 60, lineHeight: 1.12, letterSpacing: "-0.015em",
        textAlign: "center", boxShadow: "0 10px 30px rgba(0,0,0,.35)",
      }}>{card.text}</div>
    </div>
  );
};

const START = 3; // seconds into the dashboard recording where the page has settled

/* Beats 1-2: the real Obol dashboard. Dimmed for the hook, then a slow push onto the overdue total. */
const Dashboard: React.FC<{ from: number; zoom?: boolean; dim?: boolean }> = ({ from, zoom, dim }) => {
  const frame = useCurrentFrame();
  const o = dash.overdue;
  const cx = o.x + o.width / 2, cy = o.y + o.height / 2;
  const z = zoom ? interpolate(frame, [10, 120], [1, 2.35], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.4, 0, 0.2, 1) }) : 1;
  const shade = dim ? 0.55 : interpolate(frame, [0, 20], [0.55, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#071a17", overflow: "hidden" }}>
      <AbsoluteFill style={{ transformOrigin: `${cx}px ${cy}px`, transform: `scale(${z})` }}>
        <OffthreadVideo src={staticFile("captures/dashboard.webm")} startFrom={Math.round((START + from) * FPS)} muted />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: `rgba(0,0,0,${shade})` }} />
    </AbsoluteFill>
  );
};

/* Beat 9: closing card in the dashboard's paper-and-stamp style. */
const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" });
  const stamp = interpolate(frame, [18, 30], [2.2, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) });
  return (
    <AbsoluteFill style={{ background: C.paper, alignItems: "center", justifyContent: "center", opacity: o }}>
      <div style={{ textAlign: "left", marginTop: -120 }}>
        <div style={{ display: "inline-block", padding: "8px 16px 6px", border: `4px solid ${C.magenta}`, outline: `2px solid ${C.magenta}`,
          outlineOffset: 3, color: C.magenta, fontFamily: F.grot, fontWeight: 900, fontSize: 26, letterSpacing: "0.12em",
          transform: `rotate(-2deg) scale(${stamp})`, opacity: frame > 17 ? 1 : 0 }}>SECURITY-FIRST INVOICING</div>
        <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: 210, lineHeight: 0.9, letterSpacing: "-0.05em", color: C.ink, marginTop: 24 }}>OBOL.</div>
        <div style={{ fontFamily: F.grot, fontWeight: 800, fontSize: 44, color: C.ink, marginTop: 22, letterSpacing: "-0.01em", textTransform: "uppercase" }}>
          A Hermes Agent plugin · in the Hermes Marketplace
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 30, color: C.inkSoft, marginTop: 14 }}>hermes plugins install ueddy/obol</div>
      </div>
    </AbsoluteFill>
  );
};

const s = (sec: number) => Math.round(sec * FPS);
export const PREVIEW_SECONDS = 6 + 7 + 6;

export const Preview: React.FC = () => (
  <AbsoluteFill style={{ background: "#000" }}>
    <Sequence durationInFrames={s(6)}>
      <Dashboard from={0} dim />
      <Audio src={staticFile("audio/beat1.mp3")} />
      <Captions beat={1} offset={0} />
    </Sequence>
    <Sequence from={s(6)} durationInFrames={s(7)}>
      <Dashboard from={6} zoom />
      <Audio src={staticFile("audio/beat2.mp3")} />
      <Captions beat={2} offset={0} />
    </Sequence>
    <Sequence from={s(13)} durationInFrames={s(6)}>
      <Close />
      <Audio src={staticFile("audio/beat9.mp3")} />
      <Captions beat={9} offset={0} />
    </Sequence>
  </AbsoluteFill>
);
