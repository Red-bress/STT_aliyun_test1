"""Download faster-whisper-large-v3 into models/ (one-time, needs network)."""
import os
from pathlib import Path

# China-friendly optional mirror
os.environ.setdefault("HF_ENDPOINT", os.environ.get("HF_ENDPOINT", "https://hf-mirror.com"))

from huggingface_hub import snapshot_download

root = Path(__file__).resolve().parent.parent
dest = root / "models" / "faster-whisper-large-v3"
print("HF_ENDPOINT=", os.environ.get("HF_ENDPOINT"))
print("Downloading to", dest)
snapshot_download(
    repo_id="Systran/faster-whisper-large-v3",
    local_dir=str(dest),
)
assert (dest / "model.bin").exists(), "model.bin missing"
print("OK", (dest / "model.bin").stat().st_size)
