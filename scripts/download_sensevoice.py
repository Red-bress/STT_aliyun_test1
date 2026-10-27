"""Download SenseVoiceSmall into models/SenseVoiceSmall (one-time, needs network)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
dest = root / "models" / "SenseVoiceSmall"
dest.mkdir(parents=True, exist_ok=True)

print("Downloading SenseVoiceSmall ->", dest)

ok = False
# Prefer ModelScope (better in CN)
try:
    from modelscope.hub.snapshot_download import snapshot_download as ms_download

    path = ms_download("iic/SenseVoiceSmall", local_dir=str(dest))
    print("ModelScope OK:", path)
    ok = True
except Exception as e:
    print("ModelScope failed:", e)

if not ok:
    os.environ.setdefault("HF_ENDPOINT", os.environ.get("HF_ENDPOINT", "https://hf-mirror.com"))
    print("HF_ENDPOINT=", os.environ.get("HF_ENDPOINT"))
    from huggingface_hub import snapshot_download

    path = snapshot_download(
        repo_id="FunAudioLLM/SenseVoiceSmall",
        local_dir=str(dest),
    )
    print("HuggingFace OK:", path)

# Sanity: need config + weights
cfg = dest / "config.yaml"
weights = list(dest.glob("*.pt")) + list(dest.glob("model.pt")) + list(dest.glob("*.bin"))
if not cfg.exists() and not (dest / "configuration.json").exists():
    # some hubs nest one level
    nested = [p for p in dest.iterdir() if p.is_dir()]
    print("Listing:", list(dest.iterdir())[:20])
if not list(dest.glob("**/*.pt")) and not list(dest.glob("**/*.bin")) and not list(dest.glob("**/model.pt")):
    print("WARNING: no weight file found under", dest)
    sys.exit(1)

size = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file())
print(f"OK total bytes={size} (~{size/1024/1024:.1f} MB)")
