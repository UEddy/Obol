"""Voiceover for the 70-second "paper desk" demo, from one ElevenLabs take, at its original speed.

    python demo/audio/build_vo_paper.py demo/audio/takes6 demo/remotion

<takes dir>/full.mp3 holds the ten scene lines in order. A file <takes dir>/sN.mp3 (e.g. s1.mp3, s10.mp3) replaces
scene N's line with a separately generated take. This script:
1. cuts full.mp3 into ten clips at the quietest point of each gap between lines, trimmed to the speech (10 ms before
   the first sound, 20 ms after the last). Nothing is stretched, sped up or edited inside a line;
2. times every word of each clip with Whisper and maps the script's exact wording onto those times;
3. writes public/audio/paper_N.wav, paper.json (scene windows, clip lengths, word and caption times),
   out/obol-paper-70.srt, and out/obol-paper-70-voice.wav: the voice alone on the 70.0 s timeline, each clip starting
   0.3 s after its scene begins.
It reports any clip longer than its window allows and never speeds one up. The only exception is PAUSE_TRIM (agreed
with the director): silence inside a line may be shortened, never the words, which stay at their original speed.
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
# (start, end) of each scene on the 2.5 s grid, and its line split into caption cards (word for word).
SCENES = [
    (0.0, 5.0, ["Meet Obol: invoicing for Hermes Agent,", "built for security."]),
    (5.0, 15.0, ["A client messages: “send me the invoice.”", "Forward it to Hermes, and it drafts one:",
                 "who to bill, what for, how much, and when."]),
    (15.0, 22.5, ["No invoice is sent without your approval,", "every single time."]),
    (22.5, 27.5, ["It goes out as a payment link,", "or a bank-transfer PDF."]),
    (27.5, 32.5, ["Ask Hermes, “have they paid?”", "and it checks for you."]),
    (32.5, 37.5, ["Works in Telegram, WhatsApp, Slack,", "email or your terminal."]),
    (37.5, 50.0, ["Now, a scam.", "Someone copies your client's email,", "changes one letter,",
                  "and tells Hermes to skip your approval.", "Hermes flags the lookalike address,",
                  "the impersonation, and the injected order."]),
    (50.0, 57.5, ["Hidden, encoded or translated tricks get caught,", "plus duplicates, odd amounts",
                  "and changed contact or payout details."]),
    (57.5, 65.0, ["Live keys stay locked,", "scheduled runs can't send invoices,", "and the log exposes tampering."]),
    (65.0, 70.0, ["All in one dashboard.", "Obol: safe invoicing for Hermes Agent."]),
]
# Silent gaps between lines in takes6/full.mp3 (from Whisper word times, checked against the waveform).
GAPS = [(5.00, 5.62), (13.54, 14.10), (17.86, 18.30), (21.08, 21.92), (24.80, 25.10), (29.10, 29.96),
        (41.58, 42.32), (49.32, 50.08), (55.44, 56.14)]


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


def trim(seg: np.ndarray) -> np.ndarray:
    on = np.where(env_db(seg) > -40)[0]
    return seg[max(0, on[0] - int(0.01 * SR)):on[-1] + int(0.02 * SR)]


# Scene: (window in the clip to search, seconds) -> remove that much silence from the longest pause in the window.
PAUSE_TRIM = {10: ((0.9, 2.3), 0.19)}   # "All in one dashboard. | Obol: ..." 0.7 s pause -> about 0.5 s


def trim_pause(clip: np.ndarray, window: tuple[float, float], seconds: float) -> np.ndarray:
    """Cut `seconds` of silence (< -50 dB) from the middle of the longest pause inside `window`, with a 5 ms crossfade."""
    db = env_db(clip)
    a, b = int(window[0] * SR), int(window[1] * SR)
    quiet = db[a:b] < -50
    best, run, start = (0, 0), 0, 0
    for i, q in enumerate(quiet):
        if q:
            start = i if run == 0 else start
            run += 1
            if run > best[1] - best[0]:
                best = (start, start + run)
        else:
            run = 0
    n = int(seconds * SR)
    if best[1] - best[0] < n + int(0.2 * SR):
        raise SystemExit(f"pause too short to trim {seconds}s from")
    mid = a + (best[0] + best[1]) // 2
    cut0, cut1 = mid - n // 2, mid - n // 2 + n
    f = int(0.005 * SR)
    fade = np.linspace(1, 0, f)
    joined = clip[cut0 - f:cut0] * fade + clip[cut1:cut1 + f] * fade[::-1]
    return np.concatenate([clip[:cut0 - f], joined, clip[cut1 + f:]]).astype(np.float32)


def norm(w: str) -> str:
    return re.sub(r"[^a-z0-9']", "", w.lower().replace("’", "'"))


def tokens(text: str) -> list[str]:
    """Script words as Whisper hears them: "bank-transfer" is two words."""
    return [t for w in text.split() for t in w.split("-")]


def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def word_times(model, clip: np.ndarray, script: list[str]) -> list[tuple[float, float]]:
    a16 = subprocess.run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", "-f", "s16le",
                          "-ac", "1", "-ar", "16000", "-"], input=clip.tobytes(), capture_output=True, check=True).stdout
    x = np.concatenate([np.frombuffer(a16, np.int16).astype(np.float32) / 32768, np.zeros(8000, np.float32)])
    heard = [w for s in model.transcribe(x, beam_size=5, word_timestamps=True)[0] for w in s.words]
    sm = difflib.SequenceMatcher(None, [norm(w) for w in script], [norm(w.word) for w in heard])
    times: list = [None] * len(script)
    for i, j, size in sm.get_matching_blocks():
        for k in range(size):
            times[i + k] = (heard[j + k].start, heard[j + k].end)
    for i, t in enumerate(times):   # unmatched script words (e.g. "Obol" heard as "Oval"): nearest heard word
        if t is None:
            j = min(len(heard) - 1, round(i * len(heard) / max(1, len(script))))
            prev = next((times[k] for k in range(i - 1, -1, -1) if times[k]), None)
            st = heard[j].start if not prev or heard[j].start >= prev[1] - 0.05 else prev[1]
            times[i] = (st, max(st + 0.1, heard[j].end))
    return times


def main() -> int:
    from faster_whisper import WhisperModel
    takes, root = Path(sys.argv[1]), Path(sys.argv[2])
    take = load(takes / "full.mp3")
    db = env_db(take)
    cuts = [0] + [int(a * SR) + int(np.argmin(db[int(a * SR):int(b * SR)])) for a, b in GAPS] + [len(take)]
    model = WhisperModel("small.en", device="cpu", compute_type="int8")
    timeline = np.zeros(int(TOTAL * SR), np.float32)
    scenes, srt, report = [], [], []
    for n, ((s0, s1, cards), a, b) in enumerate(zip(SCENES, cuts, cuts[1:]), 1):
        own = takes / f"s{n}.mp3"
        clip = trim(load(own) if own.exists() else take[a:b])
        trimmed = 0.0
        if n in PAUSE_TRIM:
            before = len(clip)
            clip = trim_pause(clip, *PAUSE_TRIM[n])
            trimmed = (before - len(clip)) / SR
        save_wav(clip, root / "public" / "audio" / f"paper_{n}.wav")
        clip_len = len(clip) / SR
        room = (s1 - s0) - LEAD
        script = [t for c in cards for t in tokens(c)]
        times = word_times(model, clip, script)
        words, card_out, k = [], [], 0
        for text in cards:
            ws = times[k:k + len(tokens(text))]
            card_out.append({"text": text, "start": round(ws[0][0], 2), "end": round(ws[-1][1], 2)})
            words += [{"w": w, "start": round(t[0], 2), "end": round(t[1], 2)}
                      for w, t in zip(script[k:k + len(ws)], ws)]
            k += len(ws)
        for c, nxt in zip(card_out, card_out[1:] + [None]):   # a caption stays up until the next one starts
            c["end"] = nxt["start"] if nxt else round(min(clip_len + 0.3, room), 2)
        at = s0 + LEAD
        n_put = min(len(clip), int((TOTAL - at) * SR))
        timeline[int(at * SR):int(at * SR) + n_put] += clip[:n_put]
        for c in card_out:
            srt.append((at + c["start"], min(TOTAL, s1, at + c["end"]), c["text"]))
        fits = clip_len <= room + 1e-6
        scenes.append({"scene": n, "start": s0, "end": s1, "clip": f"audio/paper_{n}.wav", "clip_len": round(clip_len, 3),
                       "room": round(room, 2), "fits": fits, "source": own.name if own.exists() else "full.mp3", "pause_trimmed": round(trimmed, 3),
                       "cards": card_out, "words": words})
        report.append(f"scene {n:2d}  {s0:4.1f}-{s1:4.1f}s  clip {clip_len:5.2f}s  room {room:4.2f}s  "
                      f"{'fits' if fits else 'OVER by %.2fs' % (clip_len - room)}  ({scenes[-1]['source']}, original speed"
                      + (f"; {trimmed:.2f}s of silence removed from one pause" if trimmed else "") + ")")
    (root / "paper.json").write_text(json.dumps({"total": TOTAL, "lead": LEAD, "scenes": scenes}, indent=1, ensure_ascii=False))
    out = root / "out"
    out.mkdir(exist_ok=True)
    save_wav(timeline, out / "obol-paper-70-voice.wav")
    (out / "obol-paper-70.srt").write_text("\n".join(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{t}\n"
                                                    for i, (a, b, t) in enumerate(srt, 1)))
    print("\n".join(report))
    return 0 if all(s["fits"] for s in scenes) else 1


if __name__ == "__main__":
    raise SystemExit(main())
