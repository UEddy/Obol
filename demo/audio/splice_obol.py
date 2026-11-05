"""Replace the mispronounced "Obol" in narration takes with the correctly pronounced single-word take.

    python demo/audio/splice_obol.py          (needs ffmpeg and numpy)

ElevenLabs said "Obol" correctly (OH-bol) only when it was generated on its own
(takes/word_obol.mp3); inside sentences it drifted toward "oval" / "Obel". This script cuts the
word out of each affected beat at the quietest point near the given boundaries, level-matches the
good take to the surrounding speech, crossfades both joins, and writes the result to
demo/remotion/public/audio/beatN.mp3. Beats without "Obol" are copied unchanged.

The word spans below come from Whisper word timestamps on the takes (see demo/audio/README.md).
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
TAKES = HERE / "takes"
OUT = HERE.parent / "remotion" / "public" / "audio"
SR = 44100

# beat -> (approx start, approx end) of the spoken "Obol" in that take, seconds.
SPANS = {
    9: (3.42, 3.74),   # "...safely. Obol, in the Hermes Marketplace."
}
# Beats 4, 6 and 7 were regenerated with the name respelled "Oh-bol", which ElevenLabs then said
# correctly in context, so they are used as recorded (no splice).
# Per-beat fit of the single-word take to the sentence around it (targets measured from the voice around the
# word; confirm by ear after any change):
# target pitch in Hz (None = leave as recorded) and target length as a multiple of the replaced span.
# The single word was spoken on its own, so it comes out higher and slower than a word mid-sentence.
FIT = {
    9: (None, None),   # approved by ear as first spliced
}
SEARCH = 0.06   # look this far either side of each boundary for the quietest cut point
FADE = 0.012    # crossfade length at each join


def load(path: Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def save(audio: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                    "-c:a", "libmp3lame", "-b:a", "192k", str(path)], input=audio.astype(np.float32).tobytes(), check=True)


def envelope(a: np.ndarray, win: float = 0.01) -> np.ndarray:
    n = max(1, int(SR * win))
    return np.sqrt(np.convolve(a ** 2, np.ones(n) / n, mode="same"))


def quietest(env: np.ndarray, t: float) -> int:
    lo, hi = max(0, int((t - SEARCH) * SR)), min(len(env) - 1, int((t + SEARCH) * SR))
    return lo + int(np.argmin(env[lo:hi + 1]))


def speech_bounds(a: np.ndarray, threshold: float = 0.02) -> tuple[int, int]:
    on = np.where(envelope(a) > threshold)[0]
    return int(on[0]), int(on[-1])


def rms(a: np.ndarray) -> float:
    voiced = a[envelope(a) > 0.02]
    return float(np.sqrt(np.mean(voiced ** 2))) if len(voiced) else 1e-6


def f0(seg: np.ndarray) -> float:
    """Median pitch (Hz) over voiced 40 ms frames, by autocorrelation."""
    n, out = int(0.04 * SR), []
    for i in range(0, len(seg) - n, n // 2):
        fr = seg[i:i + n] - seg[i:i + n].mean()
        if np.sqrt(np.mean(fr ** 2)) < 0.02:
            continue
        ac = np.correlate(fr, fr, "full")[n - 1:]
        lo, hi = int(SR / 350), int(SR / 70)
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.3 * ac[0]:
            out.append(SR / k)
    return float(np.median(out)) if out else float("nan")


def fit(word: np.ndarray, pitch_hz: float | None, length_s: float | None) -> np.ndarray:
    """Shift pitch (formants preserved) and stretch length with Rubber Band via ffmpeg."""
    if pitch_hz is None and length_s is None:
        return word
    pitch = (pitch_hz / f0(word)) if pitch_hz else 1.0
    tempo = (len(word) / SR) / length_s if length_s else 1.0
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
         "-af", f"rubberband=pitch={pitch:.4f}:tempo={tempo:.4f}:formant=preserved:pitchq=quality",
         "-f", "f32le", "-ar", str(SR), "-ac", "1", "-"],
        input=word.astype(np.float32).tobytes(), capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def splice(take: np.ndarray, word: np.ndarray, start: float, end: float,
           pitch_hz: float | None = None, length_mult: float | None = None) -> np.ndarray:
    env = envelope(take)
    a, b = quietest(env, start), quietest(env, end)
    old = take[a:b]
    word = fit(word, pitch_hz, (b - a) / SR * length_mult if length_mult else None)
    w = word * (rms(old) / rms(word))            # match loudness to the word being replaced
    f = int(FADE * SR)
    ramp = np.linspace(0.0, 1.0, f, dtype=np.float32)
    head, tail = take[:a].copy(), take[b:].copy()
    w = w.copy()
    w[:f] *= ramp
    w[-f:] *= ramp[::-1]
    head[-f:] = head[-f:] * ramp[::-1] + w[:f]       # crossfade into the new word
    tail[:f] = tail[:f] * ramp + w[-f:]               # and out of it
    return np.concatenate([head, w[f:-f], tail])


def main() -> int:
    word = load(TAKES / "word_obol.mp3")
    s, e = speech_bounds(word)
    pad = int(0.015 * SR)
    word = word[max(0, s - pad):e + pad]
    for n in range(1, 10):
        src = TAKES / f"beat{n}.mp3"
        dst = OUT / f"beat{n}.mp3"
        if not src.exists():
            print(f"beat{n}: no take yet")
            continue
        if n in SPANS:
            save(splice(load(src), word, *SPANS[n], *FIT.get(n, (None, None))), dst)
            print(f"beat{n}: spliced correct 'Obol' into {src.name}")
        else:
            shutil.copyfile(src, dst)
            print(f"beat{n}: copied {src.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
