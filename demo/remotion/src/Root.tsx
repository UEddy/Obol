import React from "react";
import { Composition, registerRoot } from "remotion";
import { Demo, DEMO_FRAMES } from "./Demo";
import { FPS, H, W } from "./theme";

// Length follows the voiceover: each shot lasts as long as its line (about 62 s).
const frames = DEMO_FRAMES;

const Root: React.FC = () => (
  <>
    <Composition id="ObolDemo" component={Demo} durationInFrames={frames} fps={FPS} width={W} height={H} defaultProps={{ vertical: false }} />
    <Composition id="ObolDemoVertical" component={Demo} durationInFrames={frames} fps={FPS} width={1080} height={1350} defaultProps={{ vertical: true }} />
  </>
);

registerRoot(Root);
