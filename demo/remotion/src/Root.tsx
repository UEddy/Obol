import React from "react";
import { Composition, registerRoot, Series } from "remotion";
import { CLIPS } from "./clips";
import { End, Fan, Flow, Footage, Intro } from "./scenes";
import { FPS, H, W } from "./theme";
import { Preview, PREVIEW_SECONDS } from "./Preview";

// Seconds per scene. Total must stay under 90 s (hackathon limit); currently 78 s.
const S = { intro: 6, fan: 7, chat: 20, pay: 15, dashboard: 15, flow: 8, end: 7 };
const f = (s: number) => Math.round(s * FPS);
export const TOTAL = Object.values(S).reduce((a, b) => a + b, 0);

const ObolDemo: React.FC = () => (
  <Series>
    <Series.Sequence durationInFrames={f(S.intro)}><Intro dur={f(S.intro)} /></Series.Sequence>
    <Series.Sequence durationInFrames={f(S.fan)}><Fan dur={f(S.fan)} /></Series.Sequence>
    <Series.Sequence durationInFrames={f(S.chat)}>
      <Footage dur={f(S.chat)} clip={CLIPS.chat} label="Hermes · forwarded message" caption="Hermes proposes. You approve." />
    </Series.Sequence>
    <Series.Sequence durationInFrames={f(S.pay)}>
      <Footage dur={f(S.pay)} clip={CLIPS.pay} label="Stripe · payment link" caption="Stripe settles." />
    </Series.Sequence>
    <Series.Sequence durationInFrames={f(S.dashboard)}>
      <Footage dur={f(S.dashboard)} clip={CLIPS.dashboard} label="Hermes dashboard · Invoices" caption="The ledger stamps it." stamp="PAID" />
    </Series.Sequence>
    <Series.Sequence durationInFrames={f(S.flow)}><Flow dur={f(S.flow)} /></Series.Sequence>
    <Series.Sequence durationInFrames={f(S.end)}><End dur={f(S.end)} /></Series.Sequence>
  </Series>
);

const Root: React.FC = () => (
  <>
    <Composition id="ObolDemo" component={ObolDemo} durationInFrames={f(TOTAL)} fps={FPS} width={W} height={H} />
    <Composition id="Preview" component={Preview} durationInFrames={f(PREVIEW_SECONDS)} fps={FPS} width={W} height={H} />
  </>
);

registerRoot(Root);
