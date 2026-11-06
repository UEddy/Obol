"""Build the demo's scene voiceover clips from one ElevenLabs take.

    python demo/audio/build_vo.py demo/audio/takes4/full.mp3 demo/remotion/public/audio [tempo]

1. Cut the take into the script's eight scenes at the quietest point between scenes (CUTS: the gap between
   the last word of one scene and the first of the next, from Whisper word timestamps on the take).
2. Replace the mispronounced "Obol" in scenes 1 and 8 with takes/word_obol.mp3 (said correctly on its own),
   level-matched with crossfaded joins (same method as splice_obol.py).
3. Even out the pacing: every pause longer than MAX_PAUSE is shortened to MAX_PAUSE, so no gap in the
   finished video is dead air; edges are trimmed to the speech.
4. Slow the voice by `tempo` (default 0.78; the take runs about 4 words a second, 0.78 brings it to a
   relaxed 3.3) with Rubber Band, pitch and formants preserved, so the script
   fills the video at a relaxed pace.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from splice_obol import SR, envelope, load, save, speech_bounds, splice  # noqa: E402

HERE = Path(__file__).resolve().parent
# (start of window, end of window) between scenes, seconds in takes4/full.mp3
CUTS = [(5.44, 5.96), (15.94, 16.46), (21.86, 22.32), (26.32, 27.06), (31.08, 31.76), (43.92, 44.58), (48.16, 48.88)]
OBOL = {1: (0.64, 1.16), 8: (0.0, 0.0)}    # scene 8 starts with the word: span set relative to the scene below
MAX_PAUSE = 0.28
QUIET_DB = -33.0   # a little stricter than the -35 dB check, so quiet word tails count as pause


def quietest(env: np.ndarray, a: float, b: float) -> int:
    lo, hi = int(a * SR), int(b * SR)
    return lo + int(np.argmin(env[lo:hi]))


def cap_pauses(x: np.ndarray) -> np.ndarray:
    db = 20 * np.log10(envelope(x, 0.02) + 1e-9)
    quiet = db < QUIET_DB
    out, i, n, keep = [], 0, len(x), int(MAX_PAUSE * SR)
    while i < n:
        j = i
        while j < n and quiet[j] == quiet[i]:
            j += 1
        seg = x[i:j]
        if quiet[i] and len(seg) > keep:
            half = keep // 2
            seg = np.concatenate([seg[:half], seg[-(keep - half):]])
        out.append(seg)
        i = j
    return np.concatenate(out)


def trim(x: np.ndarray) -> np.ndarray:
    s, e = speech_bounds(x, 0.01)
    return x[max(0, s - int(0.03 * SR)):e + int(0.10 * SR)]   # keep the release of the last word


def stretch(x: np.ndarray, tempo: float) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                          "-af", f"rubberband=tempo={tempo:.4f}:formant=preserved:pitchq=quality:transients=mixed",
                          "-f", "f32le", "-ar", str(SR), "-ac", "1", "-"],
                         input=x.astype(np.float32).tobytes(), capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def main() -> int:
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    tempo = float(sys.argv[3]) if len(sys.argv) > 3 else 0.78
    take = load(src)
    env = envelope(take)
    bounds = [0] + [quietest(env, a, b) for a, b in CUTS] + [len(take)]
    word = load(HERE / "takes" / "word_obol.mp3")
    s, e = speech_bounds(word)
    word = word[max(0, s - int(0.015 * SR)):e + int(0.015 * SR)]
    total = 0.0
    for n, (a, b) in enumerate(zip(bounds, bounds[1:]), 1):
        clip = take[a:b].copy()
        if n == 1:
            clip = splice(clip, word, *OBOL[1])
        if n == 8:   # "Obol," is the scene's first word: from its onset to the pause after it
            clip = np.concatenate([np.zeros(int(0.15 * SR), np.float32), clip])
            on = speech_bounds(clip, 0.02)[0] / SR
            clip = splice(clip, word, max(0.0, on - 0.02), on + 0.34)
        clip = stretch(trim(cap_pauses(clip)), tempo)
        save(clip, out / f"scene{n}.mp3")
        total += len(clip) / SR
        print(f"scene{n}: {len(clip) / SR:.2f}s")
    print(f"total speech {total:.2f}s at tempo {tempo}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
