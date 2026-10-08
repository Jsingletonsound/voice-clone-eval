# Analysis: how every number on the page is made

Everything the page shows comes from these scripts run on the original bounces. The page
reads `data/measures.json` and `data/figures.json`. No measurement is typed into the HTML.
(`data/*.js` hold the same data so `index.html` also works opened from disk.)

## Reproduce

```bash
python3 -m venv .venv
.venv/bin/pip install -r analysis/requirements.txt
.venv/bin/python analysis/run_all.py
```

The bounces go in `source/BOUNCES /` (the folder name ends in a space), or point
`BOUNCES_DIR` at them. ffmpeg comes from `imageio-ffmpeg`; set `FFMPEG` to use your own.

`run_all.py` refuses to build when any two clone files hold the same audio. It trims
silence, aligns the files by cross-correlation and checks for |r| > 0.999, so offsets,
head cuts, gain changes and polarity flips are all caught. `--draft` builds anyway, marks
the duplicate as awaiting a re-bounce and labels dependent numbers provisional.

## Steps

| Script | What it does | Output |
| --- | --- | --- |
| `prepare.py` | Canonical copies, duplicate-take check, MP3 matching, level matching, player clips | `work/`, `audio/*.mp3`, `data/prepare.json` |
| `measure.py` | Loudness, true peak, speech timing, pauses, room tone, pitch, the S in "So" | `data/measures.json` |
| `figures.py` | Spectrogram rasters (no axes; the page draws axes, contours and callouts) | `figures/*.webp`, `data/figures.json` |
| `../tools/check_site.py` | Verbatim text, no typed-in numbers, 12 kHz limit, player levels, octave checks, weight | console |
| `../tools/browser_test.js` | Drives the page in Chrome: players, keyboard, callouts, charts, phone layout | console |

## Fair-comparison rules

- **MP3 matching.** ElevenLabs exported 192 kbps MP3 at 44.1 kHz, and the clone audio itself
  stops near 15.7 kHz (measured; a 192 kbps encoder alone would reach about 19 kHz). James's
  takes go through the same chain with the same ceiling before any comparison:
  `ffmpeg -i me.wav -ar 44100 -c:a libmp3lame -b:a 192k -cutoff 15700 me.mp3`, then back
  to 48 kHz / 24-bit. No figure shows anything above 12 kHz.
- **Level matching.** Analysis copies are normalized to −23 LUFS integrated (BS.1770,
  pyloudnorm). Player clips are normalized to a common −22 LUFS, true peak at or below
  −1 dBTP (4× oversampled), 192 kbps MP3. The brief asked for −18 LUFS, but James's
  line 1 take has a 20.6 dB peak-to-loudness ratio (the plosive on "Up"), so −18 LUFS would
  have meant limiting it. No take is limited or clipped.
- **Pitch.** pYIN, 60–400 Hz, 10 ms hop, on a 16 kHz copy. Every line and phrase median is
  checked against the harmonic spacing in the spectrum (autocorrelation of the log
  spectrum, 50 Hz–3 kHz). A value that disagrees by more than 3 semitones is withheld on
  the page. A phrase where more than 15% of either take's voiced frames are below 80 Hz
  (vocal fry) is marked not comparable: pYIN tracks James's fry but drops the clone's creak.
  `pitch_settings_max_shift_st` reports how far the whole-line offsets move under other
  reasonable pYIN settings.
- **Room tone.** James's room tone is the 20th percentile of the quiet frames inside his
  pauses, so breaths don't set it. His bounces end with short edit fades, so the level
  after his last word is not used. The clone's level after its last word is the median
  of its 20 ms frames from 50 ms after the word to the end of the file. All levels are
  floored at −120 dBFS. `noise_floor_dbfs` (the brief's whole-file 5th percentile) is
  kept in the data, but in clone files it is set by trailing digital silence.

## Figure A: the band below the fundamental

Figure 1 uses one log axis from 20 Hz to 8 kHz with two analysis windows, the same for both
takes. Above 100 Hz a 43 ms Hann window keeps the harmonics and the crackle sharp in time.
Below 100 Hz an 85 ms Blackman-Harris window (side lobes −92 dB) keeps the fundamental from
leaking into the bass band, so whatever is there is real. A dashed line marks the change.
`lines.L1.sub_f0` reports the 20–45 Hz band across "Hozier" (median, spread, 10th-to-90th
percentile swing) for the MP3-matched take, the clone and James's raw take, plus James's room
floor in the same band from his pauses: his band sits at that floor and rises with the fry on
the "-er". `lines.L1.low_end` reports the low end of the voice itself (80–300 Hz) across the
word and on the "-er", relative to James's average. `formant_map.freq_sensitivity` reports how
much the upper-formant positions move with the LPC settings.

## Line numbering

The page shows lines 1, 2 and 3. Line 3 is the bounce named `LINE 4 …` (the script was
written with five lines; three were used), so its canonical files are `L3_me`, `L3_clone1`
and `L3_clone2`.

## Word windows and callouts

`windows.json` holds the word windows (seconds, per file) and `callouts.json` the regions
marked on the figures. Both carry a `confirmed` flag. Unconfirmed callouts render dashed
until James has listened to each timestamp.
