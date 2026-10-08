"""Step A + B: canonical copies, duplicate-take check, MP3 matching, level matching.

    python analysis/prepare.py            # refuses to continue if two clone takes match
    python analysis/prepare.py --draft    # builds anyway, marks the duplicate take as missing

Outputs
    work/raw/*.wav           canonical copies of the bounces (48 kHz / 24-bit mono)
    work/mp3match/*.wav      James's takes through 192 kbps MP3 at 44.1 kHz, 15.7 kHz cutoff, back to 48 kHz
    work/analysis/*.wav      comparison copies at -23 LUFS (James = MP3-matched)
    audio/*.mp3              web player clips at -22 LUFS (see common.py for why not -18),
                             true peak <= -1 dBTP, 192 kbps
    data/prepare.json        loudness, true peak and duplicate-check results
"""
import shutil
import sys

import numpy as np

from common import (ANALYSIS, ANALYSIS_LUFS, AUDIO_OUT, DATA_OUT, FILES, LINES, MATCH,
                    PLAYER_LU_TOL, PLAYER_LUFS, PLAYER_TP_MAX, RAW, SOURCE, SR, WORK,
                    frame_rms, db, gain_to, lufs, r, read, run_ffmpeg, save_json,
                    true_peak_dbtp, write)


def trim_silence(x, rel_db=-50.0, sustain=3):
    """Cut leading/trailing audio until 3 consecutive 10 ms frames sit within 50 dB of the
    loudest frame, so a lone edit click or a breath can't anchor the trim."""
    hop = SR // 100
    rms = db(frame_rms(x, hop, hop))
    on = rms > rms.max() + rel_db
    run = np.convolve(on.astype(int), np.ones(sustain, int), mode="valid") == sustain
    idx = np.where(run)[0]
    if not len(idx):
        return x
    return x[idx[0] * hop:(idx[-1] + sustain) * hop]


def same_take(a, b):
    """True when two files hold the same audio once silence is trimmed: align them at the
    lag of the strongest cross-correlation (searched over every lag, any polarity), then
    require |r| > 0.999 over an overlap of at least 95% of the shorter file. Catches a
    re-export with an offset, a head cut, a gain change or a polarity flip."""
    from scipy.signal import correlate
    a, b = trim_silence(a), trim_silence(b)
    n = min(len(a), len(b))
    if n < SR // 10:
        return False, None
    xc = correlate(a, b, mode="full", method="fft")
    lag = int(np.argmax(np.abs(xc))) - (len(b) - 1)
    aa, bb = (a[lag:], b) if lag >= 0 else (a, b[-lag:])
    m = min(len(aa), len(bb))
    if m < 0.95 * n:
        return False, None
    aa, bb = aa[:m], bb[:m]
    corr = float(np.dot(aa, bb) / (np.linalg.norm(aa) * np.linalg.norm(bb) + 1e-12))
    return abs(corr) > 0.999, corr


def main(draft=False):
    for d in (RAW, MATCH, ANALYSIS, AUDIO_OUT):
        d.mkdir(parents=True, exist_ok=True)

    # Canonical copies
    for src, name in FILES.items():
        p = SOURCE / src
        if not p.exists():
            sys.exit(f"missing bounce: {p}")
        shutil.copyfile(p, RAW / f"{name}.wav")
    raw = {name: read(RAW / f"{name}.wav") for name in FILES.values()}

    # Duplicate-take check across every pair of clone files
    clones = [c for line in LINES.values() for c in line["clones"]]
    duplicates = []
    for i, a in enumerate(clones):
        for b in clones[i + 1:]:
            match, corr = same_take(raw[a], raw[b])
            if match:
                duplicates.append({"a": a, "b": b, "correlation": round(corr, 6)})
    if duplicates:
        msg = "; ".join(f"{d['a']} and {d['b']} are the same take" for d in duplicates)
        if not draft:
            sys.exit(f"REFUSING TO BUILD: {msg}. Re-bounce the missing take "
                     f"(or run with --draft to build a marked draft).")
        print(f"DRAFT BUILD: {msg}")

    # Step A: James's takes through the clone's MP3 chain
    for line in LINES.values():
        me = line["me"]
        mp3 = WORK / f"{me}.mp3"
        run_ffmpeg("-i", RAW / f"{me}.wav", "-ar", 44100, "-c:a", "libmp3lame",
                   "-b:a", "192k", "-cutoff", 15700, mp3)
        run_ffmpeg("-i", mp3, "-ar", SR, "-c:a", "pcm_s24le", MATCH / f"{me}_mp3match.wav")

    def comparison_source(name):
        return read(MATCH / f"{name}_mp3match.wav") if name.endswith("_me") else raw[name]

    report = {"files": {}, "duplicates": duplicates, "draft": bool(duplicates)}
    player_lufs = []
    for name in FILES.values():
        x = comparison_source(name)
        entry = {
            "raw_lufs": r(lufs(raw[name]), 2),
            "raw_true_peak_dbtp": r(true_peak_dbtp(raw[name]), 2),
            "raw_duration_s": r(len(raw[name]) / SR, 3),
            "comparison_source": "mp3match" if name.endswith("_me") else "raw",
        }
        # Analysis copy
        write(ANALYSIS / f"{name}.wav", gain_to(x, ANALYSIS_LUFS), subtype="FLOAT")

        # Player clip
        y = gain_to(x, PLAYER_LUFS)
        tp = true_peak_dbtp(y)
        if tp > PLAYER_TP_MAX:
            sys.exit(f"{name}: true peak {tp:.2f} dBTP at {PLAYER_LUFS} LUFS exceeds "
                     f"{PLAYER_TP_MAX} dBTP; refusing to limit evidence audio.")
        tmp = WORK / f"{name}_player.wav"
        write(tmp, y, subtype="FLOAT")
        out = AUDIO_OUT / f"{name}.mp3"
        run_ffmpeg("-i", tmp, "-c:a", "libmp3lame", "-b:a", "192k", "-ar", SR, out)
        dec = WORK / f"{name}_player_decoded.wav"
        run_ffmpeg("-i", out, "-c:a", "pcm_f32le", dec)
        z = read(dec)
        entry["player_lufs"] = r(lufs(z), 2)
        entry["player_true_peak_dbtp"] = r(true_peak_dbtp(z), 2)
        entry["player_file"] = f"audio/{name}.mp3"
        entry["player_duration_s"] = r(len(z) / SR, 3)
        if entry["player_true_peak_dbtp"] > PLAYER_TP_MAX:
            sys.exit(f"{name}: encoded player clip peaks at {entry['player_true_peak_dbtp']} dBTP")
        player_lufs.append(entry["player_lufs"])
        report["files"][name] = entry

    spread = max(player_lufs) - min(player_lufs)
    report["player_lufs_spread_lu"] = r(spread, 2)
    for v in player_lufs:
        if abs(v - PLAYER_LUFS) > PLAYER_LU_TOL:
            sys.exit(f"player clip at {v} LUFS is outside +/-{PLAYER_LU_TOL} LU of {PLAYER_LUFS}")
    save_json(DATA_OUT / "prepare.json", report)
    print(f"prepared {len(FILES)} files; player loudness spread {spread:.2f} LU")


if __name__ == "__main__":
    main(draft="--draft" in sys.argv)
