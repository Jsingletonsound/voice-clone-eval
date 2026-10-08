"""Rebuild everything the page reads, from the bounces.

    python analysis/run_all.py            # refuses to build if two clone takes are the same audio
    python analysis/run_all.py --draft    # builds a marked draft anyway
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
py = sys.executable
draft = ["--draft"] if "--draft" in sys.argv else []
for step in (["prepare.py", *draft], ["measure.py"], ["figures.py"]):
    print(f"== {step[0]}")
    subprocess.run([py, str(HERE / step[0]), *step[1:]], check=True, cwd=HERE)
print("== checks")
sys.exit(subprocess.run([py, str(HERE.parent / "tools" / "check_site.py"),
                         *(["--allow-draft"] if draft else [])]).returncode)
