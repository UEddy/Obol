import React from "react";
import { AbsoluteFill, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { Clip } from "./clips";
import { Card, Caption, Coin, Desk, Display, Stamp, ease } from "./parts";
import { C, F } from "./theme";

/* 1 — a coin drops, a blank card slides in and gets lettered. */
export const Intro: React.FC<{ dur: number }> = ({ dur }) => {
  const f = useCurrentFrame();
  const coinY = ease(f, 0, 24, -380, 150);
  const cardX = ease(f, 20, 52, 1500, 760);
  const cardR = ease(f, 20, 52, 18, -8);
  const letters = Math.floor(interpolate(f, [60, 96], [0, 14], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const title = "INVOICES, FROM CHAT".slice(0, letters + 5 > 19 ? 19 : letters + 5);
  return (
    <Desk>
      <Coin size={300} style={{ left: 260, top: coinY, transform: `rotate(${f * 0.2}deg)` }} />
      <Card w={760} h={470} header={120} style={{ left: cardX, top: 300, transform: `rotate(${cardR}deg)` }}>
        <Display size={92} style={{ position: "absolute", left: 46, top: 34 }}>{f > 56 ? "OBOL" : ""}</Display>
        <div style={{ position: "absolute", left: 50, top: 168, fontFamily: F.grot, fontWeight: 800, fontSize: 40,
          letterSpacing: "-0.02em", color: C.inkSoft }}>{f > 60 ? title : ""}</div>
        <div style={{ position: "absolute", left: 50, top: 236, fontFamily: F.hand, fontSize: 44, color: C.inkSoft }}>
          {f > 100 ? "a Hermes Agent plugin" : ""}
        </div>
      </Card>
      <Caption text="Hermes can now bill your clients." from={70} to={dur} />
    </Desk>
  );
};

/* 2 — the surfaces as a fan of labelled cards, like the reel's adjudicator / adapter / core row. */
const FAN = [
  { label: "TOOLS", sub: "6 obol_* tools", stamp: "CREATE · SEND · CHECK", color: C.ink },
  { label: "APPROVAL", sub: "pre_tool_call hook", stamp: "APPROVED", color: C.stamp },
  { label: "LEDGER", sub: "/invoices", stamp: "PAID", color: C.stamp },
  { label: "STRIPE", sub: "test mode first", stamp: "TEST", color: C.magenta },
];
export const Fan: React.FC<{ dur: number }> = ({ dur }) => {
  const f = useCurrentFrame();
  return (
    <Desk>
      {FAN.map((c, i) => {
        const at = 6 + i * 16;
        const x = ease(f, at, at + 22, 2000, 150 + i * 420);
        return (
          <Card key={c.label} w={460} h={600} header={110} style={{ left: x, top: 210 + (i % 2) * 22, transform: `rotate(${[-3, 1.5, -1, 2][i]}deg)` }}>
            <Display size={52} style={{ position: "absolute", left: 34, top: 36 }}>{c.label}</Display>
            <div style={{ position: "absolute", left: 36, top: 140, fontFamily: F.mono, fontSize: 28, color: C.inkSoft }}>{c.sub}</div>
            <Stamp at={at + 34} text={c.stamp} color={c.color} size={c.stamp.length > 10 ? 26 : 50}
              rotate={[-8, -12, -10, 9][i]} style={{ left: 40, top: 330 }} />
          </Card>
        );
      })}
      <Caption text="Hermes proposes." from={40} to={dur} />
    </Desk>
  );
};

/* 3–5 — real screen recordings, mounted on a card like a photo pinned to the desk. */
export const Footage: React.FC<{ dur: number; clip: Clip; label: string; caption: string; stamp?: string }> = ({ dur, clip, label, caption, stamp }) => {
  const f = useCurrentFrame();
  const y = ease(f, 0, 22, 140, 0);
  const o = ease(f, 0, 14, 0, 1);
  return (
    <Desk light={0.3}>
      <div style={{ position: "absolute", left: 258, top: 36 + y, width: 1404, height: 873, opacity: o, transform: "rotate(-0.6deg)" }}>
        <Card w={1404} h={873} header={70} radius={18}>
          <div style={{ position: "absolute", left: 30, top: 18, fontFamily: F.grot, fontWeight: 800, fontSize: 32, letterSpacing: "-0.01em", textTransform: "uppercase" }}>{label}</div>
          <div style={{ position: "absolute", right: 30, top: 24, fontFamily: F.mono, fontSize: 24, color: C.muted }}>live · stripe test mode</div>
          <div style={{ position: "absolute", left: 22, top: 86, width: 1360, height: 765, borderRadius: 8, overflow: "hidden", background: "#0e1412" }}>
            {clip.file ? (
              <OffthreadVideo src={staticFile(clip.file)} startFrom={Math.round((clip.startSeconds ?? 0) * 30)} muted
                style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : (
              <AbsoluteFill style={{ background: C.paperDeep, alignItems: "center", justifyContent: "center", padding: 100, textAlign: "center" }}>
                <Display size={64}>Screen recording goes here</Display>
                <div style={{ marginTop: 34, fontFamily: F.mono, fontSize: 30, lineHeight: 1.45, color: C.inkSoft, maxWidth: 1200 }}>{clip.what}</div>
              </AbsoluteFill>
            )}
          </div>
        </Card>
        {stamp && <Stamp at={dur - 70} text={stamp} size={92} rotate={-12} style={{ right: 90, bottom: 110 }} />}
      </div>
      <Caption text={caption} from={18} to={dur} />
    </Desk>
  );
};

/* 6 — the pipeline strip with the one rule that matters for money. */
const STEPS = ["DRAFT", "APPROVAL", "SEND", "PAID"];
export const Flow: React.FC<{ dur: number }> = ({ dur }) => {
  const f = useCurrentFrame();
  return (
    <Desk>
      <div style={{ position: "absolute", left: 160, top: 250, width: 1600, height: 420, display: "flex" }}>
        {STEPS.map((s, i) => {
          const at = 8 + i * 14;
          const o = ease(f, at, at + 12, 0, 1);
          const dx = ease(f, at, at + 16, 60, 0);
          return (
            <div key={s} style={{ flex: 1, position: "relative", opacity: o, transform: `translateX(${dx}px)` }}>
              <Card w={400} h={420} header={0} radius={i === 0 ? 16 : i === 3 ? 16 : 0}
                style={{ borderRight: i < 3 ? `3px solid ${C.ink}` : undefined }}>
                <Display size={54} style={{ position: "absolute", left: 30, bottom: 50, color: i === 3 ? C.stamp : C.ink }}>
                  {s}{i < 3 ? " →" : ""}
                </Display>
              </Card>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 712, textAlign: "center", fontFamily: F.grot, fontWeight: 500,
        fontSize: 36, color: C.inkSoft, opacity: ease(f, 70, 90, 0, 1) }}>
        every write is idempotent · an invoice bills at most once · live keys refused by default
      </div>
      <Caption text="Exact consequence. No double billing." from={60} to={dur} />
    </Desk>
  );
};

/* 7 — end card, after the reel's chop + two-line motto. */
export const End: React.FC<{ dur: number }> = ({ dur }) => {
  const f = useCurrentFrame();
  const fade = interpolate(f, [dur - 24, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const o = ease(f, 18, 34, 0, 1);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ opacity: fade }}>
        <Desk light={0.35}>
          <Stamp at={8} text="OBOL ✿ PAID" color={C.magenta} size={40} rotate={-2} style={{ left: 560, top: 300 }} />
          <div style={{ position: "absolute", left: 560, top: 410, opacity: o }}>
            <Display size={84}>Hermes proposes.<br />Stripe settles.</Display>
            <div style={{ marginTop: 28, fontFamily: F.grot, fontWeight: 800, fontSize: 34, letterSpacing: "-0.01em" }}>
              OBOL / HERMES AGENT PLUGIN · v0.1
            </div>
            <div style={{ marginTop: 12, fontFamily: F.mono, fontSize: 28, color: C.inkSoft }}>hermes plugins install ueddy/obol</div>
          </div>
        </Desk>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
