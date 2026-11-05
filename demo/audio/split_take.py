"""Split one ElevenLabs take holding every scene's line into sceneN.mp3 files, cutting at the quietest point
near each boundary (boundaries from Whisper segment times on the take), with a short fade at each cut.

    python demo/audio/split_take.py demo/audio/takes3/full.mp3 demo/remotion/public/audio
"""

import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 44100
# Approximate gaps between the seven lines in takes3/full.mp3 (seconds).
CUTS = [5.79, 11.67, 14.5, 18.71, 22.69, 25.72]
SEARCH, FADE, PAD = 0.25, 0.01, 0.0


def main() -> int:
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    a = np.frombuffer(raw, np.float32).copy()
    env = np.sqrt(np.convolve(a ** 2, np.ones(441) / 441, mode="same"))
    cuts = [0]
    for t in CUTS:
        lo, hi = int((t - SEARCH) * SR), int((t + SEARCH) * SR)
        cuts.append(lo + int(np.argmin(env[lo:hi])))
    cuts.append(len(a))
    f, pad = int(FADE * SR), np.zeros(int(PAD * SR), np.float32)
    for i, (s, e) in enumerate(zip(cuts, cuts[1:]), 1):
        seg = a[s:e].copy()
        on = np.where(np.sqrt(np.convolve(seg ** 2, np.ones(441) / 441, mode="same")) > 0.01)[0]   # trim silence
        if len(on):
            seg = seg[max(0, on[0] - int(0.04 * SR)):on[-1] + int(0.08 * SR)]
        seg[:f] *= np.linspace(0, 1, f); seg[-f:] *= np.linspace(1, 0, f)
        seg = np.concatenate([pad, seg, pad])
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                        "-c:a", "libmp3lame", "-b:a", "192k", str(out / f"scene{i}.mp3")], input=seg.tobytes(), check=True)
        print(f"scene{i}: {len(seg) / SR:.2f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
