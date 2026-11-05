# Narration audio

- `takes/beatN.mp3`: ElevenLabs takes (voice "Archer – Conversational", eleven_v4) of the lines in `../NARRATION.md`.
- `takes/word_obol.mp3`, `word_hermes.mp3`, `word_pinemoor.mp3`: the names generated on their own, for pronunciation.
- `splice_obol.py`: the voice said "Obol" correctly (OH-bol) only on its own; inside sentences it drifted to
  "oval" / "Obel". The script splices the single-word take into beats 4, 6, 7 and 9 and writes the final
  files to `../remotion/public/audio/`. Hermes and Pinemoor were already right in every take.

Checked with faster-whisper (small.en): before the splice the sentences transcribe as "oval" / "Obel" /
"Obelgard"; after it, as "Obol" / "O-ball". Re-run after replacing any take:

    python demo/audio/splice_obol.py

If a take is regenerated, update its span in `SPANS` (Whisper word timestamps) before running.
Beat 1 ("You shipped the build…") still needs a take.
