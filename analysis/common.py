"""Shared paths, file map and audio helpers for the analysis scripts."""
import json
import os
import subprocess
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(os.environ.get("BOUNCES_DIR", ROOT / "source" / "BOUNCES "))
WORK = ROOT / "work"            # intermediates, not published
RAW = WORK / "raw"              # canonical copies of the bounces
MATCH = WORK / "mp3match"       # James's takes through the clone's MP3 chain
ANALYSIS = WORK / "analysis"    # every take at -23 LUFS
AUDIO_OUT = ROOT / "audio"      # web player clips
FIG_OUT = ROOT / "figures"
DATA_OUT = ROOT / "data"
REVIEW = ROOT / "review"        # drafts for James to check, not linked from the page

SR = 48000

# Bounce file name -> canonical name. Display order is James first, then clone(s).
FILES = {
    "LINE 1 ORIGINAL.wav": "L1_me",
    "LINE 1 CLONE.wav": "L1_clone",
    "LINE 2 ORIGINAL.wav": "L2_me",
    "LINE 2 CLONE.wav": "L2_clone",
    "LINE 4 ORIGINAL.wav": "L3_me",
    "LINE 4 CLONE 1 .wav": "L3_clone1",
    "LINE 4 CLONE 2.wav": "L3_clone2",
}

LINES = {
    "L1": {"me": "L1_me", "clones": ["L1_clone"]},
    "L2": {"me": "L2_me", "clones": ["L2_clone"]},
    "L3": {"me": "L3_me", "clones": ["L3_clone1", "L3_clone2"]},
}

ANALYSIS_LUFS = -23.0
# Brief asked for -18 LUFS, but James's line 1 take has a 20.6 dB peak-to-loudness
# ratio (the plosive on "Up"): at -18 LUFS it would hit +2.6 dBTP. -22 LUFS keeps every
# clip at or below -1 dBTP without limiting or clipping any take.
PLAYER_LUFS = -22.0
PLAYER_TP_MAX = -1.0
PLAYER_LU_TOL = 0.5


def ffmpeg_exe():
    import imageio_ffmpeg
    return os.environ.get("FFMPEG", imageio_ffmpeg.get_ffmpeg_exe())


def run_ffmpeg(*args):
    cmd = [ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", *map(str, args)]
    subprocess.run(cmd, check=True)


def read(path):
    x, sr = sf.read(str(path), always_2d=False)
    if x.ndim > 1:
        x = x.mean(axis=1)
    assert sr == SR, f"{path}: expected {SR} Hz, got {sr}"
    return x.astype(np.float64)


def write(path, x, subtype="PCM_24"):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), x, SR, subtype=subtype)


def lufs(x, sr=SR):
    return float(pyln.Meter(sr).integrated_loudness(x))


def true_peak_dbtp(x, sr=SR):
    """BS.1770-4 style true peak: 4x oversampling (192 kHz at 48 kHz input)."""
    up = resample_poly(x, 4, 1)
    return float(20 * np.log10(np.max(np.abs(up)) + 1e-12))


def gain_to(x, target_lufs, sr=SR):
    return x * 10 ** ((target_lufs - lufs(x, sr)) / 20)


def db(v, floor=1e-12):
    return 20 * np.log10(np.maximum(v, floor))


def frame_rms(x, frame, hop):
    n = 1 + max(0, (len(x) - frame) // hop)
    idx = np.arange(frame)[None, :] + hop * np.arange(n)[:, None]
    return np.sqrt(np.mean(x[idx] ** 2, axis=1))


def load_json(path, default=None):
    p = Path(path)
    if not p.exists():
        return default
    return json.loads(p.read_text())


def save_json(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def save_js(path, var, obj):
    """Same data as the JSON, as a script, so index.html also works opened from disk
    (browsers block fetch() on file://). The page prefers the JSON."""
    Path(path).write_text(f"window.{var} = " + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";\n")


def r(v, nd=1):
    """Round for publication; keep None/NaN as None."""
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return None
    return round(float(v), nd)
