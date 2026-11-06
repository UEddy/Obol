"""Build the 70-second demo's voiceover from one ElevenLabs take, at its original speed.

    python demo/audio/build_vo70.py demo/audio/takes5/full.mp3 demo/remotion

The take holds the eleven scene lines in order. This script:
1. cuts it into eleven clips at the quietest point of each gap between lines, trimmed to the speech
   (10 ms before the first sound, 20 ms after the last). Nothing is stretched, sped up or edited inside a line;
2. times every word of each clip with Whisper and maps the script's exact wording onto those times;
3. writes public/audio/s70_N.wav, vo70.json (scene windows, clip lengths, word and caption-card times),
   out/obol-demo-70.srt, and out/obol-demo-70-voice.wav: the voice alone on the 70.0 s timeline, each clip
   starting 0.3 s after its scene begins, for mixing music in an editor.
"""

from __future__ import annotations

import difflib
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

SR = 44100
TOTAL = 70.0
LEAD = 0.3
# (start, end) of each scene, and its line split into caption cards (word for word).
SCENES = [
    (0, 5, ["Meet Obol: invoicing for Hermes Agent,", "with security at every step."]),
    (5, 15, ["A client messages: “send me the invoice.”", "Forward it to Hermes, and it drafts one:",
             "who to bill, what for, how much, and when."]),
    (15, 22, ["No invoice is sent without your approval, every time.", "Then your client gets a payment link."]),
    (22, 28, ["They pay by card.", "Ask Hermes, “have they paid?” and it checks."]),
    (28, 32, ["Works in Telegram, WhatsApp, Slack, email or terminal."]),
    (32, 44, ["Now, a scam.", "Someone copies your client's email,", "changes one letter,",
              "and tells Hermes to skip your approval.", "Hermes flags the lookalike address,",
              "the impersonation, and the injected order."]),
    (44, 51, ["Hidden, encoded or translated tricks get caught too,",
              "plus duplicates, odd amounts and changed contact details."]),
    (51, 57, ["After payment, it shows fraud risk and disputes.", "Live keys stay locked by default."]),
    (57, 62, ["Scheduled runs can't send invoices,", "and logs expose any tampering."]),
    (62, 67, ["Paid, open and overdue:", "on your dashboard, or type slash invoices."]),
    (67, 70, ["Obol. Safe invoicing for Hermes Agent."]),
]
# Gaps between lines in takes5/full.mp3 (from Whisper word times): cut at the quietest point inside each.
GAPS = [(4.88, 5.6), (13.38, 13.88), (19.2, 19.62), (23.42, 24.04), (27.64, 28.26), (39.72, 40.4),
        (46.74, 47.4), (52.44, 53.16), (56.8, 57.42), (62.52, 63.22)]


def load(path: Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def save_wav(a: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                    "-c:a", "pcm_s16le", str(path)], input=a.astype(np.float32).tobytes(), check=True)


def env_db(a: np.ndarray) -> np.ndarray:
    return 20 * np.log10(np.sqrt(np.convolve(a ** 2, np.ones(441) / 441, mode="same")) + 1e-9)


def norm(w: str) -> str:
    return re.sub(r"[^a-z0-9']", "", w.lower().replace("’", "'"))


def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def main() -> int:
    from faster_whisper import WhisperModel
    src, root = Path(sys.argv[1]), Path(sys.argv[2])
    take = load(src)
    db = env_db(take)
    cuts = [0] + [int(a * SR) + int(np.argmin(db[int(a * SR):int(b * SR)])) for a, b in GAPS] + [len(take)]
    model = WhisperModel("small.en", device="cpu", compute_type="int8")
    timeline = np.zeros(int(TOTAL * SR), np.float32)
    scenes, srt = [], []
    for n, ((s0, s1, cards), a, b) in enumerate(zip(SCENES, cuts, cuts[1:]), 1):
        seg = take[a:b]
        on = np.where(env_db(seg) > -45)[0]
        clip = seg[max(0, on[0] - int(0.01 * SR)):on[-1] + int(0.02 * SR)]
        save_wav(clip, root / "public" / "audio" / f"s70_{n}.wav")
        clip_len = len(clip) / SR
        room = (s1 - s0) - LEAD
        # Words: Whisper times, mapped onto the script's words (same order; fixes spelling like "Obel").
        a16 = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-f", "s16le",
                              "-ac", "1", "-ar", "16000", "-"], input=clip.tobytes(), capture_output=True, check=True).stdout
        pad = np.zeros(8000, np.float32)
        x = np.concatenate([np.frombuffer(a16, np.int16).astype(np.float32) / 32768, pad])
        heard = [w for s in model.transcribe(x, beam_size=5, word_timestamps=True)[0] for w in s.words]
        script = [w for c in cards for w in c.split()]
        sm = difflib.SequenceMatcher(None, [norm(w) for w in script], [norm(w.word) for w in heard])
        times: list = [None] * len(script)
        for i, j, size in sm.get_matching_blocks():
            for k in range(size):
                times[i + k] = (heard[j + k].start, heard[j + k].end)
        # Unmatched script words (e.g. "Obol" heard as "Obel"): take the heard word at the same position, else interpolate.
        for i, t in enumerate(times):
            if t is None:
                j = min(len(heard) - 1, round(i * len(heard) / max(1, len(script))))
                prev = next((times[k] for k in range(i - 1, -1, -1) if times[k]), None)
                st = heard[j].start if not prev or heard[j].start >= prev[1] - 0.05 else prev[1]
                times[i] = (st, max(st + 0.1, heard[j].end))
        words, card_out, k = [], [], 0
        for ci, text in enumerate(cards):
            n_words = len(text.split())
            ws = times[k:k + n_words]
            card_out.append({"text": text, "start": round(ws[0][0], 2), "end": round(ws[-1][1], 2)})
            words += [{"w": w, "start": round(t[0], 2), "end": round(t[1], 2)} for w, t in zip(script[k:k + n_words], ws)]
            k += n_words
        for c, nxt in zip(card_out, card_out[1:] + [None]):   # each card stays up until the next one starts
            c["end"] = nxt["start"] if nxt else round(min(clip_len, c["end"] + 0.4), 2)
        at = s0 + LEAD
        end_abs = min(TOTAL, at + clip_len)
        timeline[int(at * SR):int(at * SR) + int((end_abs - at) * SR)] += clip[:int((end_abs - at) * SR)]
        for c in card_out:
            srt.append((at + c["start"], min(TOTAL, at + c["end"]), c["text"]))
        scenes.append({"scene": n, "start": s0, "end": s1, "clip": f"audio/s70_{n}.wav", "clip_len": round(clip_len, 3),
                       "room": round(room, 2), "fits": clip_len <= room + 1e-6, "cards": card_out, "words": words})
        print(f"scene {n:2d}  window {s0:>2}-{s1:<2}s  clip {clip_len:5.2f}s  room {room:5.2f}s  "
              f"{'fits' if clip_len <= room else 'OVER by %.2fs' % (clip_len - room)}")
    if TOTAL * SR - (67.3 * SR + len(load(root / "public" / "audio" / "s70_11.wav"))) < 0:   # last clip runs past 70 s
        f = int(0.06 * SR)
        timeline[-f:] *= np.linspace(1, 0, f)
    (root / "vo70.json").write_text(json.dumps({"total": TOTAL, "lead": LEAD, "scenes": scenes}, indent=1, ensure_ascii=False))
    out = root / "out"
    out.mkdir(exist_ok=True)
    save_wav(timeline, out / "obol-demo-70-voice.wav")
    (out / "obol-demo-70.srt").write_text("\n".join(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{t}\n" for i, (a, b, t) in enumerate(srt, 1)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
