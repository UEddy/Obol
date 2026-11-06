import React from "react";
import { Composition, registerRoot } from "remotion";
import { Demo, DEMO_FRAMES } from "./Demo";
import { FPS, H, W } from "./theme";

// Exactly 70.0 s (2100 frames at 30 fps): the timeline is fixed by the scene windows in vo70.json.
const Root: React.FC = () => (
  <>
    <Composition id="ObolDemo" component={Demo} durationInFrames={DEMO_FRAMES} fps={FPS} width={W} height={H} />
    <Composition id="ObolDemoVertical" component={Demo} durationInFrames={DEMO_FRAMES} fps={FPS} width={1080} height={1350} />
  </>
);

registerRoot(Root);
