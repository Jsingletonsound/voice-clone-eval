"""Acceptance checks for the page. Run from the repo root:

    python tools/check_site.py

1. James's text: every sentence and table cell of content/james-text.md (section 7 of the
   brief, verbatim) appears word for word in index.html.
2. No typed-in measurements: numbers in the page's figure/readout markup come from
   data/measures.json via data-m bindings.
3. Fair comparison: figure rasters are 0-12 kHz or lower (from data/figures.json).
4. Players: every clip within +/-0.5 LU of the others, true peak <= -1 dBTP.
5. No Spotify branding: no logo, no Spotify green.
6. Page weight under 6 MB (local files only; Google Fonts excluded).
7. Duplicate takes and unconfirmed callouts are reported, not hidden.
"""
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
fails, warns = [], []


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        # A number bound from measures.json reads as {m}, matching content/james-text.md.
        if tag == "span" and ("class", "m") in attrs:
            self.parts.append("{m}")
            self.skip += 1
            self.in_m = True
        if tag in ("p", "li", "td", "th", "h1", "h2", "figcaption", "blockquote", "br", "tr"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip -= 1
        if tag == "span" and getattr(self, "in_m", False):
            self.skip -= 1
            self.in_m = False

    def handle_data(self, d):
        if not self.skip:
            self.parts.append(d)


def norm(t):
    return re.sub(r"\s+", " ", html.unescape(t)).strip()


page_html = (ROOT / "index.html").read_text()
p = Text()
p.feed(page_html)
page_text = norm("".join(p.parts))
# A "·" separator between take buttons is presentational; the source writes "me · clone".
page_text_loose = page_text.replace(" · ", " ").replace("·", " ")

# 1. James's text
src = (ROOT / "content" / "james-text.md").read_text()
checked = 0
for raw in src.splitlines():
    line = raw.strip()
    if not line or line.startswith("###") or set(line) <= set("|- "):
        continue
    line = line.lstrip("> ").strip()
    line = line.replace("**", "").replace("`", "")
    line = re.sub(r"^- ", "", line)                        # markdown bullet
    line = re.sub(r"^Figure [A-Z] caption: ", "", line)    # the brief's label, not page text
    cells = [c.strip() for c in line.strip("|").split("|")] if line.startswith("|") or " | " in line else [line]
    for c in cells:
        if not c:
            continue
        c = norm(c)
        if c.startswith("Listen:"):
            target = page_text_loose
            c = c.replace(" · ", " ")
        else:
            target = page_text
        checked += 1
        if c not in target:
            fails.append(f"James's text missing or changed: {c[:90]!r}")
print(f"[text] checked {checked} pieces of James's text")

# 2. Typed-in numbers: any digit-bearing <span class="m"> must have a data-m binding
for m in re.finditer(r'<span class="m"([^>]*)>([^<]*)</span>', page_html):
    if "data-m=" not in m.group(1):
        fails.append(f"measurement span without data-m: {m.group(0)[:80]}")
    if re.search(r"\d", m.group(2)):
        fails.append(f"number typed into a measurement span: {m.group(0)[:80]}")

measures = json.loads((ROOT / "data" / "measures.json").read_text())
figs = json.loads((ROOT / "data" / "figures.json").read_text())


def resolve(path):
    o = measures
    for k in path.split("."):
        if isinstance(o, list) and k.isdigit() and int(k) < len(o):
            o = o[int(k)]
        elif isinstance(o, dict) and k in o:
            o = o[k]
        else:
            return None
    return o


for key in set(re.findall(r'data-m="([^"]+)"', page_html)):
    if not isinstance(resolve(key), (int, float)):
        fails.append(f"data-m key not found in measures.json: {key}")

# 3. Nothing above 12 kHz
for name, f in figs["figures"].items():
    if f["fmax_hz"] > 12000:
        fails.append(f"figure {name} shows up to {f['fmax_hz']} Hz")
for name, sdat in figs["strips"].items():
    if isinstance(sdat, dict) and sdat["fmax_hz"] > 12000:
        fails.append(f"strip {name} shows up to {sdat['fmax_hz']} Hz")

# 4. Players
clips = measures["player"]["clips"]
vals = [c["lufs"] for c in clips.values()]
if max(vals) - min(vals) > 0.5:
    fails.append(f"player clips spread {max(vals) - min(vals):.2f} LU (> 0.5)")
for n, c in clips.items():
    if c["true_peak_dbtp"] > -1.0:
        fails.append(f"{n} player clip true peak {c['true_peak_dbtp']} dBTP")
    if not (ROOT / "audio" / f"{n}.mp3").exists():
        fails.append(f"missing player clip audio/{n}.mp3")

# 2b. Captions and labels written for the page carry no typed-in measurements
for name, sel in (("Figure C caption", r'<figure\b[^>]*\bid="figC"[^>]*>.*?<figcaption>(.*?)</figcaption>'),
                  ("Figure 5 caption", r'<figure\b[^>]*\bid="figF"[^>]*>.*?<figcaption>(.*?)</figcaption>'),
                  ("Figure 2 caption", r'<figure\b[^>]*\bid="figD"[^>]*>.*?<figcaption>(.*?)</figcaption>'),
                  ("readout labels", r'<div\b[^>]*class="readout-label"[^>]*>(.*?)</div>')):
    found = list(re.finditer(sel, page_html, re.S))
    if not found:
        fails.append(f"could not find the {name} to scan for typed-in numbers")
    for m in found:
        txt = re.sub(r'<span class="m"[^>]*>.*?</span>', "", m.group(1))
        txt = re.sub(r"<[^>]+>", "", txt)
        txt = re.sub(r"\b[Ll]ines? \d( (and|/) \d)*( / \d)*\b", "", txt)   # line numbers
        txt = re.sub(r"\d+(\.\d+)?\s*[–-]\s*\d+(\.\d+)?\s*k?Hz", "", txt)        # band labels (settings)
        txt = re.sub(r"\bF\d\b", "", txt)                                            # formant names
        if re.search(r"\d", txt):
            fails.append(f"typed-in number in a caption/label: {norm(txt)[:90]!r}")

# 5. Branding
lower = page_html.lower() + (ROOT / "assets/css/style.css").read_text().lower() + \
    (ROOT / "assets/js/app.js").read_text().lower()
for green in ("#1db954", "#1ed760", "#1db954".upper().lower()):
    if green in lower:
        fails.append(f"Spotify green {green} found")
if re.search(r"spotify[^\"']*\.(svg|png|webp|jpg)", lower):
    fails.append("Spotify logo asset referenced")

# 6. Weight
weight = 0
for rel in ["index.html", "assets/css/style.css", "assets/js/app.js", "data/measures.json", "data/figures.json"]:
    weight += (ROOT / rel).stat().st_size
weight += sum(f.stat().st_size for f in (ROOT / "audio").glob("*.mp3"))
weight += sum(f.stat().st_size for f in (ROOT / "figures").glob("*.webp"))
print(f"[weight] {weight / 1e6:.2f} MB local (fonts load from Google)")
if weight > 6e6:
    fails.append(f"page weight {weight / 1e6:.2f} MB > 6 MB")

# 7. Draft state
missing = measures["status"]["missing_takes"]
if missing:
    (warns if "--allow-draft" in sys.argv else fails).append(f"duplicate takes (draft build): {missing}")
allc = [c for k, v in figs["callouts"].items() if isinstance(v, list) for c in v] + \
    [c for v in figs["callouts"]["strips"].values() for c in v]
unconf = [c["id"] for c in allc if not c["confirmed"]]
if unconf:
    warns.append(f"{len(unconf)} callouts not confirmed by James: {', '.join(unconf)}")
ph = len(re.findall(r'class="placeholder"', page_html))
if ph:
    warns.append(f"{ph} visible placeholders")
for line, L in measures["lines"].items():
    for who, v in L.get("f0_octave_check", {}).items():
        if v != "pass":
            fails.append(f"whole-line pitch for {line} ({who}) fails the octave check: {v}")
    for w, ph_ in L["phrases"].items():
        for who in ("me", "clone"):
            v = ph_.get(f"octave_check_{who}")
            if v and v != "pass":
                warns.append(f"octave check {line} '{w}' ({who}): {v} - must be withheld on the page "
                             f"(tools/browser_test.js checks the rendered table)")

for w in warns:
    print("WARN ", w)
for f in fails:
    print("FAIL ", f)
print("OK" if not fails else f"{len(fails)} failure(s)")
sys.exit(1 if fails else 0)
