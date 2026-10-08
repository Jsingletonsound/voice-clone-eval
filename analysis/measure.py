"""Step C: every number on the page. Reads work/analysis/*.wav (all at -23 LUFS; James's
takes MP3-matched) and writes data/measures.json.

    python analysis/measure.py
"""
import librosa
import numpy as np
from scipy.signal import welch

from common import (ANALYSIS, ANALYSIS_LUFS, DATA_OUT, LINES, MATCH, PLAYER_LUFS, RAW, ROOT, SR, db, frame_rms, lufs,
                    load_json, r, save_js, read, save_json)

F0_MIN, F0_MAX = 60.0, 400.0
F0_SR, F0_HOP, F0_FRAME = 16000, 160, 1024     # 10 ms hop, 64 ms frame
NOISE_FRAME = int(0.020 * SR)                    # 20 ms RMS frames
NOISE_HOP = int(0.010 * SR)
SPEECH_THRESH_DBFS = -50.0                       # on the -23 LUFS copies
MIN_PAUSE_S = 0.120
KEEPERS = {"L1": "L1_clone", "L2": "L2_clone", "L3": "L3_clone2"}


def st(a, b):
    """Semitones from a to b."""
    if a is None or b is None or a <= 0 or b <= 0:
        return None
    return 12 * np.log2(b / a)


def missing_takes():
    prep = load_json(DATA_OUT / "prepare.json", {})
    return {d["b"]: d["a"] for d in prep.get("duplicates", [])}


def speech_activity(x):
    # Clamp at -120 dBFS so digital-zero frames (-240 with the 1e-12 floor) can't drag a
    # median or percentile into nonsense.
    rms = np.maximum(db(frame_rms(x, NOISE_FRAME, NOISE_HOP)), -120.0)
    t = (np.arange(len(rms)) * NOISE_HOP + NOISE_FRAME / 2) / SR
    active = rms > SPEECH_THRESH_DBFS
    idx = np.where(active)[0]
    start, end = t[idx[0]], t[idx[-1]]
    pauses, run = [], None
    for i in range(idx[0], idx[-1] + 1):
        if not active[i] and run is None:
            run = i
        elif active[i] and run is not None:
            if (i - run) * NOISE_HOP / SR >= MIN_PAUSE_S:
                pauses.append([r(t[run], 3), r(t[i - 1], 3)])
            run = None
    return rms, t, float(start), float(end), pauses


def pitch(x):
    y = librosa.resample(x, orig_sr=SR, target_sr=F0_SR)
    f0, voiced, prob = librosa.pyin(y, fmin=F0_MIN, fmax=F0_MAX, sr=F0_SR,
                                    frame_length=F0_FRAME, hop_length=F0_HOP)
    t = librosa.times_like(f0, sr=F0_SR, hop_length=F0_HOP)
    f0 = np.where(voiced, f0, np.nan)
    return t, f0


ROOM_PCT = 20


def room_in_pauses(rms, rt, pauses, edge=0.03):
    """Room tone: the 20th percentile of the quiet 20 ms frames inside pauses of 120 ms or
    more, skipping 30 ms at each edge. A low percentile keeps breaths and word decay in the
    pause from setting the level. None when the take has no such pause."""
    m = np.zeros(len(rms), bool)
    for a, b in pauses:
        m |= (rt >= a + edge) & (rt <= b - edge)
    m &= rms <= SPEECH_THRESH_DBFS
    return float(np.percentile(rms[m], ROOM_PCT)) if m.sum() >= 3 else None


PITCH_VARIANTS = [(16000, 1024), (16000, 640), (24000, 1536), (32000, 2048)]


def pitch_median_variants(x):
    """Whole-take median F0 under other reasonable pYIN settings (sample rate, frame length),
    to show how much the published medians depend on the analysis settings."""
    out = []
    for sr, frame in PITCH_VARIANTS:
        y = librosa.resample(x, orig_sr=SR, target_sr=sr)
        f0, voiced, _ = librosa.pyin(y, fmin=F0_MIN, fmax=F0_MAX, sr=sr, frame_length=frame,
                                     hop_length=sr // 100)
        v = f0[voiced & np.isfinite(f0)]
        out.append(float(np.median(v)) if len(v) else None)
    return out


SUB_F0_BAND = (20.0, 45.0)
UPPER_BAND, REF_BAND = (3000.0, 4000.0), (300.0, 1000.0)


def vowel_profile(x, t0, t1, f0_t, f0, fmax=6000.0):
    """Average spectrum of the voiced 30 ms frames (5 ms steps) in a window, and the level of
    the 3-4 kHz band (around the fourth formant) relative to 0.3-1 kHz (first-formant region).
    A ratio inside each take, so loudness differences between takes don't enter."""
    L = int(0.03 * SR)
    frames = []
    for tc in np.arange(t0, t1, 0.005):
        k = np.argmin(np.abs(f0_t - tc))
        if np.isfinite(f0[k]):
            c = int(tc * SR)
            seg = x[c - L // 2:c + L // 2]
            if len(seg) == L:
                frames.append(seg)
    if not frames:
        return None
    n = 4 * L
    f = np.fft.rfftfreq(n, 1 / SR)
    P = np.mean([np.abs(np.fft.rfft(sg * np.hanning(L), n)) ** 2 for sg in frames], axis=0)
    band = lambda lo, hi: 10 * np.log10(P[(f >= lo) & (f < hi)].mean() + 1e-30)
    keep = f <= fmax
    step = max(1, int(round(40 / f[1])))               # ~40 Hz per published point
    return {"upper_rel_db": r(band(*UPPER_BAND) - band(*REF_BAND), 1),
            "voiced_frames": len(frames),
            "spectrum": {"freq_hz": [r(v, 0) for v in f[keep][::step]],
                         "db": [r(v, 1) for v in (10 * np.log10(P[keep] + 1e-30) - band(*REF_BAND))[::step]]}}


FORMANT_BANDS = ((200, 1000), (700, 2600), (1800, 3500), (2800, 4800))


def formant_freqs(x, t0, t1, f0_t, f0, order=14, sr2=11025):
    """Median F1-F4 (Hz) over the voiced 30 ms frames of a window (5 ms steps), from LPC on an
    11 kHz copy (pre-emphasis 0.63, Hamming, order 14). Per frame, each formant is the first
    LPC resonance (bandwidth < 500 Hz) inside its band and at least 200 Hz above the one below.
    Averaging per word makes word length irrelevant. Estimates, not ground truth: least certain
    for F1/F2 on short words and when pitch is high."""
    from scipy.signal import lfilter
    L = int(0.03 * SR)
    rows = []
    for tc in np.arange(t0, t1, 0.005):
        k = np.argmin(np.abs(f0_t - tc))
        if not np.isfinite(f0[k]):
            continue
        c = int(tc * SR)
        seg = x[c - L // 2:c + L // 2]
        if len(seg) < L:
            continue
        y = lfilter([1, -0.63], [1], librosa.resample(seg, orig_sr=SR, target_sr=sr2))
        y = y * np.hamming(len(y))
        a = librosa.lpc(y, order=order)
        roots = [q for q in np.roots(a) if np.imag(q) >= 0.01]
        fr = np.arctan2(np.imag(roots), np.real(roots)) * sr2 / (2 * np.pi)
        bw = -0.5 * (sr2 / (2 * np.pi)) * np.log(np.abs(roots))
        cand = sorted(f for f, b in zip(fr, bw) if 200 < f < 5000 and b < 500)
        F, last = [np.nan] * 4, 0
        for i, (lo, hi) in enumerate(FORMANT_BANDS):
            v = next((f for f in cand if lo <= f < hi and f > last + 200), None)
            if v is not None:
                F[i], last = v, v
        rows.append(F)
    med = np.nanmedian(np.array(rows), axis=0) if rows else [np.nan] * 4
    return {f"F{i + 1}_hz": r(v, 0) for i, v in enumerate(med)} | {"voiced_frames": len(rows)}


def breath_on_voice(x, f0_t, f0, t0, t1):
    """After a vowel: when breath noise (2-8 kHz, 20 ms frames) jumps 6 dB or more while the
    voice is still sounding, and when the voicing stops. Overlap > 0 means the exhale sits on
    the end of the vowel, so cutting it would cut into the voice."""
    from scipy.signal import butter, sosfiltfilt
    y = sosfiltfilt(butter(6, [2000, 8000], btype="band", fs=SR, output="sos"), x)
    ts = np.arange(t0, t1, 0.01)
    lv = np.array([20 * np.log10(np.sqrt(np.mean(y[int((t - 0.01) * SR):int((t + 0.01) * SR)] ** 2)) + 1e-12) for t in ts])
    voiced = np.array([np.isfinite(f0[np.argmin(np.abs(f0_t - t))]) for t in ts])
    # voicing end: first unvoiced run of 50 ms or more
    end = None
    for i in range(len(ts) - 5):
        if not voiced[i:i + 5].any():
            end = ts[i]
            break
    rise = None
    run_min = lv[0]
    for i in range(1, len(ts)):
        run_min = min(run_min, lv[i - 1])
        if voiced[i] and lv[i] - run_min >= 6 and (end is None or ts[i] < end):
            rise = ts[i]
            break
    return {"noise_rise_s": r(rise, 2) if rise is not None else None, "voicing_end_s": r(end, 2) if end is not None else None,
            "overlap_s": r(end - rise, 2) if rise is not None and end is not None else 0.0}


def opening_drop(t, f0, start, open_s=0.6):
    """Median pitch in the first 0.6 s of speech minus the median of the rest, in semitones."""
    v = np.isfinite(f0)
    a = f0[v & (t >= start) & (t <= start + open_s)]
    b = f0[v & (t > start + open_s)]
    return r(12 * np.log2(np.median(a) / np.median(b)), 1) if len(a) and len(b) else None


def sub_f0_band(x, t0, t1, onset):
    """Level of the band well below the fundamental (20-45 Hz; the lowest F0 on "Hozier" is
    about 92 Hz) across a word, from a 4096-sample Blackman-Harris STFT (85 ms, -92 dB side
    lobes) so the fundamental cannot leak into the band. Returns summary stats and the series."""
    from scipy.signal.windows import blackmanharris
    win, nfft, hop = 4096, 16384, 240
    w = blackmanharris(win)
    X = np.abs(librosa.stft(x, n_fft=nfft, hop_length=hop, win_length=win, window=w)) * 2 / w.sum()
    f = np.fft.rfftfreq(nfft, 1 / SR)
    t = np.arange(X.shape[1]) * hop / SR
    band = (f >= SUB_F0_BAND[0]) & (f <= SUB_F0_BAND[1])
    lv = 10 * np.log10(np.mean(X[band] ** 2, axis=0) + 1e-20)
    m = (t >= t0) & (t <= t1)
    v = lv[m]
    return {"median_db": r(np.median(v), 1), "frame_std_db": r(np.std(v), 1),
            "swing_p10_p90_db": r(np.percentile(v, 90) - np.percentile(v, 10), 1),
            "series": {"t_s": [r(a - onset, 3) for a in t[m]], "db": [r(a, 1) for a in v]}}


def harmonic_spacing(x, t0, t1, f0_track_t, f0_track):
    """Independent check on pYIN: the spacing between harmonics in the magnitude spectrum,
    from the autocorrelation of each voiced frame's spectrum (50 Hz - 3 kHz)."""
    nfft, win = 16384, 2048
    w = np.hanning(win)
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    band = (freqs >= 50) & (freqs <= 3000)
    df = freqs[1]
    lag_min, lag_max = int(F0_MIN * 0.9 / df), int(F0_MAX * 1.1 / df)
    est = []
    for tc, f in zip(f0_track_t, f0_track):
        if not (t0 <= tc <= t1) or not np.isfinite(f):
            continue
        c = int(tc * SR)
        seg = x[max(0, c - win // 2):c + win // 2]
        if len(seg) < win:
            continue
        mag = np.log(np.abs(np.fft.rfft(seg * w, nfft))[band] + 1e-9)
        mag = mag - mag.mean()
        ac = np.correlate(mag, mag, "full")[len(mag) - 1:]
        seg_ac = ac[lag_min:lag_max]
        peaks = [i for i in range(1, len(seg_ac) - 1)
                 if seg_ac[i] > seg_ac[i - 1] and seg_ac[i] >= seg_ac[i + 1] and seg_ac[i] > 0]
        if not peaks:
            continue
        top = max(seg_ac[i] for i in peaks)
        first = min(i for i in peaks if seg_ac[i] >= 0.8 * top)
        est.append((first + lag_min) * df)
    return float(np.median(est)) if est else None, len(est)


def f0_stats(t, f0, t0=None, t1=None):
    m = np.isfinite(f0)
    if t0 is not None:
        m &= (t >= t0) & (t <= t1)
    v = f0[m]
    if len(v) == 0:
        return None
    return {"median_hz": r(np.median(v), 1), "p10_hz": r(np.percentile(v, 10), 1),
            "p90_hz": r(np.percentile(v, 90), 1), "voiced_frames": int(len(v))}


def band_db(x, lo, hi):
    f, p = welch(x, SR, nperseg=4096)
    m = (f >= lo) & (f < hi)
    return 10 * np.log10(np.sum(p[m]) + 1e-20)


def s_analysis(x, s_win, v_win):
    s = x[int(s_win[0] * SR):int(s_win[1] * SR)]
    v = x[int(v_win[0] * SR):int(v_win[1] * SR)]
    s_db = 20 * np.log10(np.sqrt(np.mean(s ** 2)))
    v_db = 20 * np.log10(np.sqrt(np.mean(v ** 2)))
    f, p = welch(s, SR, nperseg=1024, noverlap=768, window="hann")   # 47 Hz bins
    m = (f >= 2000) & (f <= 12000)
    pb = p[m]
    flat = float(np.exp(np.mean(np.log(pb + 1e-20))) / np.mean(pb))
    spec_db = 10 * np.log10(pb + 1e-20)
    fb = f[m]
    # Strongest peak between 3 and 7 kHz and how far it stands above its neighbours
    # (mean level 0.5-1.5 kHz either side of it).
    pk_m = (fb >= 3000) & (fb <= 7000)
    i = np.argmax(np.where(pk_m, spec_db, -np.inf))
    fpk = fb[i]
    flank = ((np.abs(fb - fpk) >= 500) & (np.abs(fb - fpk) <= 1500))
    prominence = spec_db[i] - 10 * np.log10(np.mean(pb[flank]))
    # -10 dB width of the S energy: where the spectrum is within 10 dB of its max
    above = fb[spec_db >= spec_db.max() - 10]
    lin = 10 ** (spec_db / 10)
    centroid = np.sum(fb * lin) / np.sum(lin)
    top = (fb >= 8000) & (fb <= 12000)
    slope = np.polyfit(fb[top] / 1000, spec_db[top], 1)[0]
    return {
        "centroid_hz": r(centroid, 0),
        "rolloff_8_12k_db_per_khz": r(slope, 1),
        "s_minus_vowel_db": r(s_db - v_db, 1),
        "flatness_2_12k": r(flat, 2),
        "peak_hz": r(fpk, 0),
        "peak_prominence_db": r(prominence, 1),
        "within_10db_of_max_hz": [r(above.min(), 0), r(above.max(), 0)],
        "spectrum": {"freq_hz": [r(v, 0) for v in fb], "db": [r(v, 2) for v in spec_db]},
    }


def main():
    windows = load_json(ROOT / "analysis" / "windows.json")
    missing = missing_takes()
    out = {
        "_about": ("Generated by analysis/measure.py from the bounces. James's takes are "
                   "MP3-matched (192 kbps at 44.1 kHz, 15.7 kHz cutoff) and every take is normalized to "
                   f"{ANALYSIS_LUFS} LUFS before measuring. Do not edit by hand."),
        "settings": {
            "analysis_lufs": ANALYSIS_LUFS,
            "f0": {"method": "librosa pYIN", "fmin_hz": F0_MIN, "fmax_hz": F0_MAX,
                   "hop_ms": 10, "frame_ms": 64, "resampled_to_hz": F0_SR},
            "noise_floor": "5th percentile of 20 ms RMS frames (10 ms hop) over the whole file, dBFS at -23 LUFS "
                           "(the brief's definition; in clone files it is set by trailing digital silence, so the page "
                           "uses room_in_pauses and tail_median instead)",
            "tail_after_speech": "RMS from 50 ms after the last word to the end of the file",
            "tail_median": "median of 20 ms RMS frames from 50 ms after the last word to the end of the file "
                           "(used for the clone; my bounces end with edit fades)",
            "tail_envelope": "20 ms RMS frames (10 ms hop) from 250 ms before the last word ends to the end of the file; "
                             "t = 0 is the end of the last word (last frame above the speech threshold)",
            "speech_threshold_dbfs": SPEECH_THRESH_DBFS,
            "min_pause_s": MIN_PAUSE_S,
            "fry_rule": "a phrase is marked not comparable when more than 15% of either take's voiced frames are below 80 Hz",
            "octave_check": "median harmonic spacing (spectrum autocorrelation) vs pYIN median; "
                            "flagged when they differ by more than 3 semitones; run per phrase and over each whole line",
            "room_in_pauses": "20th percentile of the quiet 20 ms frames (at or below the speech threshold) inside "
                              "pauses of 120 ms or more, skipping 30 ms at each pause edge, so breaths don't set it",
            "level_floor_dbfs": -120,
            "pitch_variants": [{"resampled_to_hz": a, "frame": b, "hop_ms": 10} for a, b in PITCH_VARIANTS],
        },
        "status": {"missing_takes": missing, "provisional": []},
        "files": {}, "lines": {}, "contours": {},
    }

    prep = load_json(DATA_OUT / "prepare.json", {})
    out["player"] = {"target": PLAYER_LUFS,
                     "spread": prep.get("player_lufs_spread_lu"),
                     "clips": {n: {"lufs": f.get("player_lufs"), "true_peak_dbtp": f.get("player_true_peak_dbtp")}
                               for n, f in prep.get("files", {}).items() if n not in missing}}
    tracks = {}
    for line, cfg in LINES.items():
        for name in [cfg["me"], *cfg["clones"]]:
            if name in missing:
                continue
            x = read(ANALYSIS / f"{name}.wav")
            rms, rt, start, end, pauses = speech_activity(x)
            t, f0 = pitch(x)
            tracks[name] = (x, t, f0, start)
            spacing, _ = harmonic_spacing(x, start, end, t, f0)
            f0s = f0_stats(t, f0)
            octave = "pass" if spacing and abs(st(f0s["median_hz"], spacing)) <= 3 else \
                f"FAIL ({abs(st(f0s['median_hz'], spacing)):.1f} st)" if spacing else "no estimate"
            tail = x[int(min(end + 0.05, len(x) / SR) * SR):]
            after = rms[rt >= end + 0.05]
            env_m = rt >= end - 0.25
            pf = prep.get("files", {}).get(name, {})
            out["files"][name] = {
                "noise_floor_dbfs": r(np.percentile(rms, 5), 1),
                "room_in_pauses_dbfs": r(room_in_pauses(rms, rt, pauses), 1),
                "tail_after_speech_dbfs": r(20 * np.log10(np.sqrt(np.mean(tail ** 2)) + 1e-12), 1)
                if len(tail) > SR * 0.03 else None,
                # Typical level after the last word: median of the 20 ms frames from 50 ms after
                # the last word to the end of the file. Used for the clone; my own bounces end
                # with short edit fades, so mine is not compared.
                "tail_median_dbfs": r(np.median(after), 1) if len(after) >= 5 else None,
                "tail_envelope": {"t_s": [r(v - end, 3) for v in rt[env_m]],
                                  "dbfs": [r(max(v, -120.0), 1) for v in rms[env_m]]},
                "speech_start_s": r(start, 3), "speech_end_s": r(end, 3),
                "speech_duration_s": r(end - start, 3),
                "pauses_s": pauses,
                "f0": f0s,
                "f0_harmonic_spacing_hz": r(spacing, 1),
                "f0_octave_check": octave,
                "f0_median_variants_hz": [r(v, 1) for v in pitch_median_variants(x)],
                "low_vs_mid_db": r(band_db(x, 60, 250) - band_db(x, 250, 4000), 1),
                "raw_lufs": pf.get("raw_lufs"), "raw_true_peak_dbtp": pf.get("raw_true_peak_dbtp"),
            }

    for line, cfg in LINES.items():
        me = cfg["me"]
        keeper = KEEPERS[line]
        comp = keeper if keeper not in missing else missing[keeper]
        if comp != keeper:
            out["status"]["provisional"].append(
                {"line": line, "measured_on": comp, "stands_in_for": keeper,
                 "reason": f"{keeper} is the same audio as {comp}; re-bounce pending"})
        fm, fc = out["files"][me], out["files"][comp]
        L = {"me": me, "clone": comp, "keeper": keeper, "provisional": comp != keeper,
             "f0_median_me_hz": fm["f0"]["median_hz"], "f0_median_clone_hz": fc["f0"]["median_hz"],
             "f0_diff_st": r(st(fm["f0"]["median_hz"], fc["f0"]["median_hz"]), 1),
             "noise_floor_diff_db": r(fm["noise_floor_dbfs"] - fc["noise_floor_dbfs"], 1),
             # My room tone (in my pauses) vs. the clone's level after its last word. My own
             # bounces end with short edit fades, so my tail is not used for this.
             "room_gap_db": r(fm["room_in_pauses_dbfs"] - fc["tail_median_dbfs"], 1)
             if fm["room_in_pauses_dbfs"] is not None and fc["tail_median_dbfs"] is not None else None,
             "f0_octave_check": {"me": fm["f0_octave_check"], "clone": fc["f0_octave_check"]},
             "f0_diff_st_variants": [r(st(a, b), 1) if a and b else None
                                     for a, b in zip(fm["f0_median_variants_hz"], fc["f0_median_variants_hz"])],
             "phrases": {}}
        for word, w in windows.get(line, {}).items():
            if word.startswith("_") or word == "S in So" or me not in w or w.get(comp) is None:
                continue
            ph = {"window_me_s": w[me], "window_clone_s": w[comp], "confirmed": w["confirmed"]}
            for who, name in (("me", me), ("clone", comp)):
                x, t, f0, _ = tracks[name]
                stats = f0_stats(t, f0, *w[name])
                spacing, n = harmonic_spacing(x, *w[name], t, f0)
                ph[f"f0_{who}"] = stats
                ph[f"harmonic_spacing_{who}_hz"] = r(spacing, 1)
                if stats and spacing:
                    gap = abs(st(stats["median_hz"], spacing))
                    ph[f"octave_check_{who}"] = "pass" if gap <= 3 else f"FAIL ({gap:.1f} st)"
                # Share of voiced frames below 80 Hz (vocal fry / creak). pYIN tracks my fry but
                # often marks the clone's creak unvoiced, so a phrase with much fry on either
                # side is not a fair median comparison.
                m = np.isfinite(f0) & (t >= w[name][0]) & (t <= w[name][1])
                ph[f"fry_share_{who}"] = r(np.mean(f0[m] < 80), 2) if m.any() else None
            if ph["f0_me"] and ph["f0_clone"]:
                ph["f0_diff_st"] = r(st(ph["f0_me"]["median_hz"], ph["f0_clone"]["median_hz"]), 1)
            ph["comparable"] = all((ph.get(f"fry_share_{k}") or 0) <= 0.15 for k in ("me", "clone"))
            L["phrases"][word] = ph
        if line == "L3":
            sw, vw = windows["L3"]["S in So"], windows["L3"]["o in So (vowel after the S)"]
            s_me = s_analysis(tracks[me][0], sw[me], vw[me])
            s_cl = s_analysis(tracks[comp][0], sw[comp], vw[comp])
            # Like for like: my S at the clone's peak frequency, against the same flanks; and how
            # much the clone's peak moves with reasonable analysis settings.
            def prom_at(x, win, f_at, nper=1024, flank=(500, 1500)):
                seg = x[int(win[0] * SR):int(win[1] * SR)]
                f, pw = welch(seg, SR, nperseg=nper, noverlap=nper * 3 // 4, window="hann")
                dbs = 10 * np.log10(pw + 1e-20)
                i = int(np.argmin(np.abs(f - f_at)))
                fl = (np.abs(f - f[i]) >= flank[0]) & (np.abs(f - f[i]) <= flank[1])
                return float(dbs[i] - 10 * np.log10(np.mean(pw[fl])))
            def prom_peak(x, win, nper, flank):
                seg = x[int(win[0] * SR):int(win[1] * SR)]
                f, pw = welch(seg, SR, nperseg=nper, noverlap=nper * 3 // 4, window="hann")
                m = (f >= 3000) & (f <= 7000)
                i = np.where(m)[0][int(np.argmax(pw[m]))]
                return prom_at(x, win, f[i], nper, flank)
            s_me["prominence_at_clone_peak_db"] = r(prom_at(tracks[me][0], sw[me], s_cl["peak_hz"]), 1)
            grid = [prom_peak(tracks[comp][0], sw[comp], n, fl) for n in (512, 1024, 2048)
                    for fl in ((300, 1000), (500, 1500), (1000, 2000))]
            s_cl["peak_prominence_range_db"] = [r(min(grid), 1), r(max(grid), 1)]
            L["s_in_so"] = {"me": s_me, "clone": s_cl, "confirmed": sw["confirmed"],
                            "clone_hotter_db": r(s_cl["s_minus_vowel_db"] - s_me["s_minus_vowel_db"], 1)}
        # Upper-formant level (3-4 kHz vs 0.3-1 kHz) over every voiced frame of the line, and
        # how much each take drops in pitch after its opening.
        um, uc = [vowel_profile(tracks[n][0], fs["speech_start_s"], fs["speech_end_s"], tracks[n][1], tracks[n][2])
                  for n, fs in ((me, fm), (comp, fc))]
        L["upper_formant_line"] = {"me": um["upper_rel_db"], "clone": uc["upper_rel_db"],
                                   "clone_minus_me_db": r(uc["upper_rel_db"] - um["upper_rel_db"], 1)}
        L["opening_drop_st"] = {who: opening_drop(tracks[n][1], tracks[n][2], tracks[n][3])
                                for who, n in (("me", me), ("clone", comp))}
        if line == "L3":
            so = windows["L3"]["So"]
            L["breath_after_so"] = {n: breath_on_voice(tracks[n][0], tracks[n][1], tracks[n][2], so[n][1] - 0.25, so[n][1] + 0.45)
                                    for n in cfg["clones"] if n in tracks and so.get(n)}
        if line == "L2":
            uf = {"band_hz": list(UPPER_BAND), "ref_band_hz": list(REF_BAND), "words": {}}
            for word in ("Get", "then"):
                w = windows["L2"][word]
                pm = vowel_profile(tracks[me][0], *w[me], tracks[me][1], tracks[me][2])
                pc = vowel_profile(tracks[comp][0], *w[comp], tracks[comp][1], tracks[comp][2])
                fqm = formant_freqs(tracks[me][0], *w[me], tracks[me][1], tracks[me][2])
                fqc = formant_freqs(tracks[comp][0], *w[comp], tracks[comp][1], tracks[comp][2])
                pm["formants"], pc["formants"] = fqm, fqc
                gap = max(abs(fqc[k] / fqm[k] - 1) for k in ("F3_hz", "F4_hz")) * 100
                uf["words"][word] = {"me": pm, "clone": pc, "window_me_s": w[me], "window_clone_s": w[comp],
                                     "formant_freq_max_diff_pct": r(gap, 1),
                                     "clone_minus_me_db": r(pc["upper_rel_db"] - pm["upper_rel_db"], 1),
                                     "clone_word_minus_clone_line_db": r(pc["upper_rel_db"] - uc["upper_rel_db"], 1),
                                     "me_word_minus_me_line_db": r(pm["upper_rel_db"] - um["upper_rel_db"], 1),
                                     "confirmed": w["confirmed"]}
            uf["formant_freq_max_diff_pct"] = max(v["formant_freq_max_diff_pct"] for v in uf["words"].values())
            L["upper_formant"] = uf
        if line == "L1":
            hw = windows["L1"]["Hozier"]
            sub = {"band_hz": list(SUB_F0_BAND), "window": "4096-sample Blackman-Harris, 5 ms hop",
                   "me": sub_f0_band(tracks[me][0], *hw[me], hw[me][0]),
                   "clone": sub_f0_band(tracks[comp][0], *hw[comp], hw[comp][0])}
            # My raw take at the same gain as the MP3-matched copy: shows the MP3 chain does not
            # create or remove this texture.
            raw = read(RAW / f"{me}.wav")
            g = 10 ** ((ANALYSIS_LUFS - lufs(read(MATCH / f"{me}_mp3match.wav"))) / 20)
            rs = sub_f0_band(raw * g, *hw[me], hw[me][0])
            sub["me_raw"] = {k: rs[k] for k in ("median_db", "frame_std_db", "swing_p10_p90_db")}
            # My room floor in the same 20-45 Hz band, from my pauses: the "texture" under my
            # fundamental sits at this floor except where my "-er" fry rises above it.
            xm, tm, f0m, _ = tracks[me]
            floors = [sub_f0_band(xm, a + 0.03, b - 0.03, a)["median_db"] for a, b in fm["pauses_s"] if b - a > 0.1]
            sub["me_room_floor_db"] = r(np.median(floors), 1) if floors else None
            L["sub_f0"] = sub
            # The low end of the voice itself (80-300 Hz: the fundamental and the first
            # harmonics), absolute level at matched loudness, across the word and on the "-er".
            er = {me: (5.20, 5.45), comp: (5.32, 5.53)}
            low = {"band_hz": [80, 300], "er_window_s": {"me": list(er[me]), "clone": list(er[comp])},
                   "note": "'-er' windows: clone from the confirmed crackle callout; mine from where my pitch dips into the '-er' (approximate)"}
            for who, n in (("me", me), ("clone", comp)):
                x = tracks[n][0]
                hop, win = int(0.005 * SR), int(0.04 * SR)
                w0, w1 = hw[n]
                ts = np.arange(w0, w1, 0.005)
                lv = []
                for tc in ts:
                    seg = x[int(tc * SR) - win // 2:int(tc * SR) + win // 2]
                    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), 8192)) ** 2
                    f = np.fft.rfftfreq(8192, 1 / SR)
                    lv.append(10 * np.log10(spec[(f >= 80) & (f < 300)].sum() + 1e-20))
                lv = np.array(lv)
                # Low-to-mid balance: 80-300 Hz against 300-3,000 Hz, the "thin EQ" measure.
                def band_sum(lo_hz, hi_hz, t0_, t1_):
                    seg = x[int(t0_ * SR):int(t1_ * SR)]
                    f_, pw = welch(seg, SR, nperseg=4096)
                    return 10 * np.log10(pw[(f_ >= lo_hz) & (f_ < hi_hz)].sum() + 1e-30)
                bal_word = band_sum(80, 300, w0, w1) - band_sum(300, 3000, w0, w1)
                bal_er = band_sum(80, 300, *er[n]) - band_sum(300, 3000, *er[n])
                e0, e1 = er[n]
                low[who] = {"balance_word_db": r(bal_word, 1), "balance_er_db": r(bal_er, 1),
                            "word_db": r(10 * np.log10(np.mean(10 ** (lv / 10))), 1),
                            "er_db": r(10 * np.log10(np.mean(10 ** (lv[(ts >= e0) & (ts <= e1)] / 10))), 1),
                            "series": {"t_s": [r(v - w0, 3) for v in ts], "db": [r(v, 1) for v in lv]}}
            low["clone_minus_me_word_db"] = r(low["clone"]["word_db"] - low["me"]["word_db"], 1)
            low["clone_minus_me_er_db"] = r(low["clone"]["er_db"] - low["me"]["er_db"], 1)
            # Publish relative to my average across the word (0 dB), so only differences show.
            ref0 = low["me"]["word_db"]
            for who in ("me", "clone"):
                low[who]["series"]["db"] = [r(v - ref0, 1) for v in low[who]["series"]["db"]]
                low[who]["word_db"] = r(low[who]["word_db"] - ref0, 1)
                low[who]["er_db"] = r(low[who]["er_db"] - ref0, 1)
            low["reference"] = "0 dB = my average 80-300 Hz level across the word (both takes at -23 LUFS)"
            L["low_end"] = low
        out["lines"][line] = L

        # Pitch contours for figure C: semitones re James's median, time from speech start.
        ref = fm["f0"]["median_hz"]
        out["contours"][line] = {}
        for who, name in (("me", me), ("clone", comp)):
            x, t, f0, start = tracks[name]
            semis = 12 * np.log2(f0 / ref)
            out["contours"][line][who] = {
                "t_s": [r(v, 2) for v in (t - start)],
                "st": [r(v, 2) if np.isfinite(v) else None for v in semis],
            }

    # Formant map: every word with a window in both takes, plus each whole line. Each word is
    # averaged over its voiced frames, so its length doesn't matter.
    MAP_WORDS = [("L1", "Hozier"), ("L2", "Get"), ("L2", "then"), ("L3", "So"), ("L3", "what are you in the mood for")]
    fmap = {"rows": [], "method": "LPC formants and 3-4 kHz vs 0.3-1 kHz level, median over voiced frames"}
    for line, word in MAP_WORDS + [(ln, None) for ln in LINES]:
        Lx = out["lines"][line]
        me_n, cl_n = Lx["me"], Lx["clone"]
        row = {"line": line, "word": word or "whole line"}
        for who, n in (("me", me_n), ("clone", cl_n)):
            x, t, f0, _ = tracks[n]
            a, b = (windows[line][word][n] if word else (out["files"][n]["speech_start_s"], out["files"][n]["speech_end_s"]))
            row[who] = formant_freqs(x, a, b, t, f0) | {"upper_rel_db": vowel_profile(x, a, b, t, f0)["upper_rel_db"]}
        row["pct_diff"] = {k: r(100 * (row["clone"][k] / row["me"][k] - 1), 1) for k in ("F1_hz", "F2_hz", "F3_hz", "F4_hz")}
        row["upper_diff_db"] = r(row["clone"]["upper_rel_db"] - row["me"]["upper_rel_db"], 1)
        fmap["rows"].append(row)
    words_only = [x for x in fmap["rows"] if x["word"] != "whole line"]
    fmap["summary"] = {
        "upper_formants_max_abs_pct": r(max(abs(x["pct_diff"][k]) for x in fmap["rows"] for k in ("F3_hz", "F4_hz")), 1),
        "vowel_formants_max_abs_pct": r(max(abs(x["pct_diff"][k]) for x in words_only for k in ("F1_hz", "F2_hz")), 1),
        "upper_diff_min_db": r(min(x["upper_diff_db"] for x in words_only), 1),
        "upper_diff_max_db": r(max(x["upper_diff_db"] for x in words_only), 1),
        "words_clone_hotter": sum(x["upper_diff_db"] > 0 for x in words_only), "words": len(words_only),
    }
    # How much the "same place" result depends on the LPC settings: the largest F3/F4 gap
    # across the words under several reasonable settings.
    gaps = []
    for order, sr2 in ((12, 11025), (14, 11025), (16, 11025), (14, 10000), (18, 16000)):
        g = 0
        for line, word in MAP_WORDS:
            Lx = out["lines"][line]
            fr = {}
            for who, n in (("me", Lx["me"]), ("clone", Lx["clone"])):
                x, t, f0, _ = tracks[n]
                fr[who] = formant_freqs(x, *windows[line][word][n], t, f0, order=order, sr2=sr2)
            for k in ("F3_hz", "F4_hz"):
                if fr["me"][k] and fr["clone"][k]:
                    g = max(g, abs(fr["clone"][k] / fr["me"][k] - 1) * 100)
        gaps.append({"lpc_order": order, "resampled_to_hz": sr2, "max_gap_pct": r(g, 1)})
    fmap["freq_sensitivity"] = gaps
    fmap["summary"]["upper_formants_gap_range_pct"] = [min(x["max_gap_pct"] for x in gaps), max(x["max_gap_pct"] for x in gaps)]
    out["formant_map"] = fmap

    spreads = [abs(v - L["f0_diff_st"]) for L in out["lines"].values() for v in L["f0_diff_st_variants"]
               if v is not None]
    out["pitch_settings_max_shift_st"] = r(max(spreads), 1)
    save_json(DATA_OUT / "measures.json", out)
    save_js(DATA_OUT / "measures.js", "__MEASURES__", out)
    # Short console summary
    for line, L in out["lines"].items():
        print(line, f"F0 me {L['f0_median_me_hz']} clone {L['f0_median_clone_hz']} "
                    f"diff {L['f0_diff_st']} st | floor diff {L['noise_floor_diff_db']} dB"
                    + ("  [PROVISIONAL]" if L["provisional"] else ""))
        for w, ph in L["phrases"].items():
            print("   ", w, ph.get("f0_me", {}) and ph["f0_me"]["median_hz"],
                  ph.get("f0_clone", {}) and ph["f0_clone"]["median_hz"], ph.get("f0_diff_st"),
                  "spacing", ph.get("harmonic_spacing_me_hz"), ph.get("harmonic_spacing_clone_hz"),
                  ph.get("octave_check_me"), ph.get("octave_check_clone"))
    for n, f in out["files"].items():
        print(n, "floor", f["noise_floor_dbfs"], "room", f["room_in_pauses_dbfs"], "oct", f["f0_octave_check"], f["f0_median_variants_hz"], "tail", f["tail_after_speech_dbfs"], "speech",
              f["speech_start_s"], f["speech_end_s"], "pauses", f["pauses_s"], "low/mid", f["low_vs_mid_db"])
    s = out["lines"]["L3"]["s_in_so"]
    print("S:", {k: v for k, v in s["me"].items() if k != "spectrum"},
          {k: v for k, v in s["clone"].items() if k != "spectrum"}, s["clone_hotter_db"])


if __name__ == "__main__":
    main()
