import React from "react";
import { Composition, registerRoot } from "remotion";
import { Demo, DEMO_SECONDS } from "./Demo";
import { FPS, H, W } from "./theme";

// Total stays under 90 s (hackathon limit); it follows the narration clips (about 66 s).
const frames = Math.ceil(DEMO_SECONDS * FPS);

const Root: React.FC = () => (
  <>
    <Composition id="ObolDemo" component={Demo} durationInFrames={frames} fps={FPS} width={W} height={H} defaultProps={{ vertical: false }} />
    <Composition id="ObolDemoVertical" component={Demo} durationInFrames={frames} fps={FPS} width={1080} height={1350} defaultProps={{ vertical: true }} />
  </>
);

registerRoot(Root);
