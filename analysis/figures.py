"""Render the spectrogram rasters the page draws its figures on, plus figures.json, which
tells the page how each raster maps to time and frequency. Axes, labels, contours and
callouts are drawn by the page from figures.json and measures.json so they stay sharp and
readable on a phone.

    python analysis/figures.py

Every spectrogram in one figure shares one dB scale, one colormap and one set of FFT
settings. Nothing above 12 kHz is ever rendered (the clone files are MP3 whose content stops near 15.7 kHz
ceiling; the ceiling is not a finding).
"""
import librosa
import numpy as np
from matplotlib import colormaps
from matplotlib.colors import LinearSegmentedColormap
from PIL import Image

from common import (ANALYSIS, DATA_OUT, FIG_OUT, LINES, REVIEW, ROOT, SR, load_json, r, save_js, read,
                    save_json)
from measure import pitch

FMAX = 12000
CMAP = LinearSegmentedColormap.from_list(
    "ink", ["#0a0e16", "#121a27", "#25344a", "#4f6178", "#8c99a8", "#d8d3c8", "#fbf6ea"])
RANGE_DB = 80


def _oklch_to_srgb(L, C, h_deg):
    """OKLCH -> linear OKLab -> sRGB (0-1), vectorised."""
    h = np.deg2rad(h_deg)
    a, b = C * np.cos(h), C * np.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s3 = l_ ** 3, m_ ** 3, s_ ** 3
    rgb = np.stack([4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s3,
                    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s3,
                    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s3], -1)
    lin = np.clip(rgb, 0, 1)
    return np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055), \
        np.all((rgb >= -1e-4) & (rgb <= 1 + 1e-4), axis=-1)


def matched_cmap(name, hue, steps=256, c_max=0.22):
    """A colormap whose OKLab lightness is the same at every step for any hue, so an amber
    take and a teal take at the same level look equally bright. Chroma peaks mid-ramp and is
    pulled in wherever a colour would fall outside sRGB."""
    t = np.linspace(0, 1, steps)
    L = 0.14 + 0.83 * t
    C = c_max * np.sin(np.pi * np.clip(t, 0, 1) ** 0.7) * (1 - 0.35 * t)
    for _ in range(40):                       # reduce chroma until every step is in gamut
        rgb, ok = _oklch_to_srgb(L, C, np.full(steps, hue))
        if ok.all():
            break
        C = np.where(ok, C, C * 0.9)
    return LinearSegmentedColormap.from_list(name, rgb)


def matched_cmap_path(name, hues, steps=256, c_max=0.2):
    """Like matched_cmap, but the hue travels along a path (as in RX's fire-style display),
    which gives far more visible contrast. Lightness is still identical at every step for
    every path, so equal levels look equally bright in both takes."""
    t = np.linspace(0, 1, steps)
    L = 0.12 + 0.86 * t
    H = np.interp(t, np.linspace(0, 1, len(hues)), hues)
    C = c_max * np.sin(np.pi * np.clip(t, 0, 1) ** 0.75) * (1 - 0.3 * t)
    for _ in range(60):
        rgb, ok = _oklch_to_srgb(L, C, H)
        if ok.all():
            break
        C = np.where(ok, C, C * 0.92)
    return LinearSegmentedColormap.from_list(name, rgb)


# James = warm (purple, red, orange, yellow), clone = cool (indigo, blue, cyan, aqua).
# Same lightness ramp; only the hue differs.
CMAPS = {"me": matched_cmap_path("me", [325, 380, 405, 432, 455]),
         "clone": matched_cmap_path("clone", [285, 255, 225, 200, 180])}


def stft_db(x, n_fft, hop, win, kind="hann"):
    if kind == "blackmanharris":
        from scipy.signal.windows import blackmanharris
        w = blackmanharris(win)
    else:
        w = np.hanning(win)
    X = np.abs(librosa.stft(x, n_fft=n_fft, hop_length=hop, win_length=win, window=w,
                            center=True)) * 2 / w.sum()
    return 20 * np.log10(np.maximum(X, 1e-10)), np.fft.rfftfreq(n_fft, 1 / SR)


def to_image(S_db, vmax, path, width, height, freqs, fmin, fmax, log=False, range_db=RANGE_DB,
             valid_until=None, gamma=1.0, low=None, cmap=None, smooth=None):
    """Resample a dB matrix onto a width x height pixel grid and save as WebP.
    valid_until (0-1): columns after this fraction are past the end of the file and are left
    transparent, so the page can mark them instead of drawing fake silence."""
    vmin = vmax - range_db
    if log:
        rows = np.geomspace(fmax, fmin, height)
    else:
        rows = np.linspace(fmax, fmin, height)
    # frequency interpolation (rows), then time interpolation (columns)
    S_f = np.stack([np.interp(rows, freqs, S_db[:, j]) for j in range(S_db.shape[1])], axis=1)
    if low is not None:
        # Rows below the split come from a longer, low-leakage STFT (see figure A).
        S_lo, f_lo, fsplit = low
        n = min(S_f.shape[1], S_lo.shape[1])
        L_f = np.stack([np.interp(rows, f_lo, S_lo[:, j]) for j in range(n)], axis=1)
        S_f = S_f[:, :n]
        S_f[rows < fsplit] = L_f[rows < fsplit]
    cols = np.linspace(0, S_f.shape[1] - 1, width)
    S_ft = np.stack([np.interp(cols, np.arange(S_f.shape[1]), S_f[i]) for i in range(height)])
    if smooth:
        # Light smoothing so zero-padding nulls don't draw as dots; same for every panel.
        from scipy.ndimage import gaussian_filter
        S_ft = 10 * np.log10(gaussian_filter(10 ** (S_ft / 10), smooth) + 1e-20)
    norm = np.clip((S_ft - vmin) / (vmax - vmin), 0, 1) ** gamma   # same curve for every panel
    rgba = ((cmap or CMAP)(norm) * 255).astype(np.uint8)
    if valid_until is not None and valid_until < 1:
        rgba[:, int(np.ceil(valid_until * width)):, 3] = 0
        img = Image.fromarray(rgba)
    else:
        img = Image.fromarray(rgba[..., :3])
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=82, method=6)
    return f"{path.relative_to(ROOT)}"


def window(x, t0, t1):
    a, b = int(round(t0 * SR)), int(round(t1 * SR))
    seg = np.zeros(b - a)
    lo, hi = max(a, 0), min(b, len(x))
    seg[lo - a:hi - a] = x[lo:hi]
    return seg


def f0_in(name, t0, t1):
    t, f0 = pitch(read(ANALYSIS / f"{name}.wav"))
    m = (t >= t0) & (t <= t1)
    return {"t_s": [r(v - t0, 3) for v in t[m]],
            "hz": [r(v, 1) if np.isfinite(v) else None for v in f0[m]]}


def main():
    meas = load_json(DATA_OUT / "measures.json")
    windows = load_json(ROOT / "analysis" / "windows.json")
    callouts = load_json(ROOT / "analysis" / "callouts.json")
    missing = meas["status"]["missing_takes"]
    out = {"_about": "Generated by analysis/figures.py. Raster geometry for the page.",
           "colormap": "matched-lightness amber (James) and teal (clone): identical OKLab lightness "
                       "at every dB step, so equal levels look equally bright", "range_db": RANGE_DB,
           "strips": {}, "figures": {}, "callouts": callouts}

    # Channel-strip spectrograms: the whole file, 0-12 kHz, one dB scale per line.
    n_fft, hop, win = 2048, 240, 1024          # 21 ms window, 5 ms hop
    for line, cfg in LINES.items():
        names = [n for n in [cfg["me"], *cfg["clones"]] if n not in missing]
        specs = {n: stft_db(read(ANALYSIS / f"{n}.wav"), n_fft, hop, win) for n in names}
        vmax = max(np.percentile(S[f <= FMAX], 99.9) for S, f in specs.values())
        for n, (S, f) in specs.items():
            dur = len(read(ANALYSIS / f"{n}.wav")) / SR
            src = to_image(S, vmax, FIG_OUT / f"strip_{n}.webp", int(dur * 400), 460, f, 0, FMAX,
                           cmap=CMAPS["me" if n.endswith("_me") else "clone"])
            out["strips"][n] = {"src": src, "duration_s": r(dur, 3), "fmin_hz": 0,
                                "fmax_hz": FMAX, "scale": "linear",
                                "speech_start_s": meas["files"][n]["speech_start_s"]}
        out["strips"][line + "_db"] = [r(vmax - RANGE_DB, 1), r(vmax, 1)]

    # Figure A: "Hozier", log frequency 20 Hz - 4 kHz, aligned on word onset.
    # Two resolutions on one log axis, identical for both takes: above 100 Hz a 43 ms Hann
    # window (harmonics and the crackle stay sharp in time); below 100 Hz an 85 ms
    # Blackman-Harris window, so the band under the fundamental is resolved without the
    # fundamental leaking into it.
    L1 = meas["lines"]["L1"]
    # Tight on the word (both takes, 0.82 s from 50 ms before onset), 20 Hz to 8 kHz.
    pre, span = 0.05, 0.82
    RANGE_A, GAMMA_A, FMIN_A, FMAX_A, FSPLIT_A = 100, 1.2, 20, 8000, 100
    panels, specs = {}, {}
    for who in ("me", "clone"):
        name = L1[who]
        on = windows["L1"]["Hozier"][name][0]
        t0, t1 = on - pre, on - pre + span
        seg = window(read(ANALYSIS / f"{name}.wav"), t0, t1)
        specs[who] = (stft_db(seg, 4096, 48, 2048),                       # 43 ms Hann, 1 ms hop
                      stft_db(seg, 8192, 48, 4096, "blackmanharris"))     # 85 ms Blackman-Harris
        file_end = len(read(ANALYSIS / f"{name}.wav")) / SR
        panels[who] = {"file": name, "t0_s": r(t0, 3), "t1_s": r(t1, 3), "onset_s": on,
                       "file_end_s": r(file_end, 3) if file_end < t1 else None,
                       "word_end_s": windows["L1"]["Hozier"][name][1],
                       "f0": f0_in(name, t0, t1)}
    m = lambda f: (f >= FMIN_A) & (f <= FMAX_A)
    vmax = max(max(Sh[m(fh)].max(), Sl[m(fl)].max()) for (Sh, fh), (Sl, fl) in specs.values())
    for who, ((Sh, fh), (Sl, fl)) in specs.items():
        fe = panels[who]["file_end_s"]
        valid = None if fe is None else (fe - panels[who]["t0_s"]) / span
        panels[who]["src"] = to_image(Sh, vmax, FIG_OUT / f"figA_{who}.webp", 2400, 900, fh, FMIN_A,
                                      FMAX_A, log=True, range_db=RANGE_A, valid_until=valid,
                                      gamma=GAMMA_A, low=(Sl, fl, FSPLIT_A), cmap=CMAPS[who], smooth=(1.0, 1.2))
    out["figures"]["A"] = {"fmin_hz": FMIN_A, "fmax_hz": FMAX_A, "fsplit_hz": FSPLIT_A, "scale": "log", "pre_s": pre,
                           "gamma": GAMMA_A, "span_s": span, "db": [r(vmax - RANGE_A, 1), r(vmax, 1)],
                           "fft": "above 100 Hz: 2048-sample Hann (43 ms); below 100 Hz: 4096-sample "
                                  "Blackman-Harris (85 ms); 1 ms hop; light smoothing", "panels": panels}

    # Figure B: the S in "So", 0-12 kHz linear, aligned on the S onset.
    L3 = meas["lines"]["L3"]
    pre, span = 0.07, 0.60
    panels, specs = {}, {}
    for who in ("me", "clone"):
        name = L3[who]
        on = windows["L3"]["S in So"][name][0]
        t0, t1 = on - pre, on - pre + span
        seg = window(read(ANALYSIS / f"{name}.wav"), t0, t1)
        specs[who] = stft_db(seg, 2048, 96, 1024)          # 21 ms window, 2 ms hop
        panels[who] = {"file": name, "t0_s": r(t0, 3), "t1_s": r(t1, 3), "onset_s": on,
                       "s_window_s": windows["L3"]["S in So"][name],
                       "vowel_window_s": windows["L3"]["o in So (vowel after the S)"][name]}
    vmax = max(np.percentile(S[f <= FMAX], 99.8) for S, f in specs.values())
    for who, (S, f) in specs.items():
        panels[who]["src"] = to_image(S, vmax, FIG_OUT / f"figB_{who}.webp", 900, 720, f, 0, FMAX,
                                      cmap=CMAPS[who])
    out["figures"]["B"] = {"fmin_hz": 0, "fmax_hz": FMAX, "scale": "linear", "pre_s": pre,
                           "span_s": span, "db": [r(vmax - RANGE_DB, 1), r(vmax, 1)],
                           "fft": "1024-sample Hann (21 ms), 2 ms hop",
                           "provisional": L3["provisional"], "panels": panels}

    # Figure D (shown as Figure 2): "Get" and "then" on line 2, 0-6 kHz so the formants are
    # readable, aligned on each word's onset. One dB scale across all four panels.
    L2 = meas["lines"]["L2"]
    pre, span = 0.08, 0.50
    words, specs = {}, {}
    for word in ("Get", "then"):
        words[word] = {"panels": {}}
        for who in ("me", "clone"):
            name = L2[who]
            w0, w1 = windows["L2"][word][name]
            t0 = w0 - pre
            seg = window(read(ANALYSIS / f"{name}.wav"), t0, t0 + span)
            specs[(word, who)] = stft_db(seg, 2048, 96, 1024)       # 21 ms Hann, 2 ms hop
            words[word]["panels"][who] = {"file": name, "t0_s": r(t0, 3), "t1_s": r(t0 + span, 3),
                                          "onset_s": w0, "word_window_s": [w0, w1]}
    vmax = max(S[f <= 6000].max() for S, f in specs.values())
    for (word, who), (S, f) in specs.items():
        words[word]["panels"][who]["src"] = to_image(S, vmax, FIG_OUT / f"figD_{word.lower()}_{who}.webp",
                                                     1000, 600, f, 0, 6000, cmap=CMAPS[who])
    out["figures"]["D"] = {"fmin_hz": 0, "fmax_hz": 6000, "scale": "linear", "pre_s": pre, "span_s": span,
                           "db": [r(vmax - RANGE_DB, 1), r(vmax, 1)], "fft": "1024-sample Hann (21 ms), 2 ms hop",
                           "words": words}

    # Hero band: every shown clip, end to end, low contrast. Tinted in the page.
    order = [n for cfg in LINES.values() for n in [cfg["me"], *cfg["clones"]] if n not in missing]
    S_all, owners = [], []
    for n in order:
        S, f = stft_db(read(ANALYSIS / f"{n}.wav"), 2048, 480, 2048)
        S_all.append(S)
        owners.append([n, S.shape[1]])
    S = np.concatenate(S_all, axis=1)
    vmax = np.percentile(S[f <= 8000], 99.5)
    width = 2400
    src = to_image(S, vmax, FIG_OUT / "hero_band.webp", width, 160, f, 80, 8000, log=True)
    total = sum(c for _, c in owners)
    acc, segs = 0, []
    for n, c in owners:
        segs.append({"file": n, "x0": r(acc / total, 4), "x1": r((acc + c) / total, 4),
                     "who": "me" if n.endswith("_me") else "clone"})
        acc += c
    out["hero"] = {"src": src, "segments": segs}

    save_json(DATA_OUT / "figures.json", out)
    save_js(DATA_OUT / "figures.js", "__FIGURES__", out)
    print("figures written")


def review_figD(meas, windows):
    """Draft zoom of "Get" and "then" (line 2) for James to check by ear. Not on the page."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axs = plt.subplots(4, 2, figsize=(12, 9), gridspec_kw={"height_ratios": [3, 1, 3, 1]},
                            facecolor="#0b0f17")
    for c, word in enumerate(("Get", "then")):
        for k, (who, col) in enumerate((("me", "#f5a524"), ("clone", "#35c9d6"))):
            name = meas["lines"]["L2"][who]
            w0, w1 = windows["L2"][word][name]
            t0, t1 = w0 - 0.15, w1 + 0.15
            x = read(ANALYSIS / f"{name}.wav")
            seg = window(x, t0, t1)
            S, f = stft_db(seg, 2048, 48, 512)
            ax = axs[2 * k, c]
            ax.imshow(S[f <= FMAX][::-1], aspect="auto", cmap=CMAP, vmin=S.max() - RANGE_DB,
                      vmax=S.max(), extent=[t0, t1, 0, FMAX / 1000])
            ax.axvspan(w0, w1, color=col, alpha=0.12)
            ax.set_title(f'{word}: {"James" if who == "me" else "clone"} ({name}, {w0}-{w1} s)',
                         color=col, fontsize=10)
            ax.set_ylabel("kHz", color="#ccc")
            axw = axs[2 * k + 1, c]
            axw.plot(np.linspace(t0, t1, len(seg)), seg, color=col, lw=0.5)
            axw.set_xlim(t0, t1)
            for a in (ax, axw):
                a.set_facecolor("#0b0f17")
                a.tick_params(colors="#ccc", labelsize=8)
    fig.suptitle("DRAFT for James: confirm the crackle on line 2 by ear before figure D is built",
                 color="#fff")
    plt.tight_layout()
    REVIEW.mkdir(exist_ok=True)
    plt.savefig(REVIEW / "figD_draft_line2_get_then.png", dpi=110, facecolor="#0b0f17")


if __name__ == "__main__":
    main()
