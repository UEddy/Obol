"""Time each caption card to the narration audio, word by word.

    python demo/audio/caption_timing.py      (needs faster-whisper, numpy, ffmpeg)

Reads the caption cards from demo/remotion/narration.json and the clips in
demo/remotion/public/audio/, transcribes each clip with word timestamps, and writes
demo/remotion/captions.json: for every beat, the clip length and each card's start and end
(seconds from the start of the clip). Cards keep the script's exact wording; only their timing
comes from the audio, so captions always match the narration word for word.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
NARRATION = ROOT / "remotion" / "narration.json"
AUDIO = ROOT / "remotion" / "public"
OUT = ROOT / "remotion" / "captions.json"


def load16k(path: Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def main() -> int:
    from faster_whisper import WhisperModel
    model = WhisperModel("small.en", device="cpu", compute_type="int8")
    beats = json.loads(NARRATION.read_text())["beats"]
    out = []
    for i, beat in enumerate(beats, 1):
        path = AUDIO / beat["audio"]
        if not path.exists():
            out.append({"beat": beat["beat"], "duration": None, "cards": []})
            continue
        audio = load16k(path)
        duration = len(audio) / 16000
        words = [w for s in model.transcribe(audio, beam_size=5, word_timestamps=True)[0] for w in s.words]
        script_words = sum(len(c.split()) for c in beat["captions"])
        cards, k = [], 0
        for c in beat["captions"]:
            n = len(c.split())
            # Map the card's first/last script word onto the transcript proportionally (word counts can
            # differ slightly, e.g. "they've"), then take those words' timestamps.
            first = words[min(len(words) - 1, round(k * len(words) / script_words))]
            last = words[min(len(words) - 1, max(0, round((k + n) * len(words) / script_words) - 1))]
            cards.append({"text": c, "start": round(first.start, 2), "end": round(last.end, 2)})
            k += n
        for a, b in zip(cards, cards[1:]):  # hold each card until the next one starts
            a["end"] = b["start"]
        cards[-1]["end"] = round(duration, 2)
        out.append({"beat": beat["beat"], "duration": round(duration, 2), "cards": cards})
        print(f"beat{i}: {duration:.1f}s, {len(cards)} cards")
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
