"""Local SenseVoice-Small ASR via FunASR (fully offline after model download)."""

from __future__ import annotations

import logging
import os
import tempfile
import threading
import wave
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger("asr")

SAMPLE_RATE = 16000


def _write_wav(path: Path, audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> None:
    if audio.dtype != np.float32:
        audio = audio.astype(np.float32)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1.0:
        audio = audio / peak
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())


def _map_language(lang: Optional[str]) -> str:
    if not lang:
        return "auto"
    low = lang.lower()
    if low.startswith("zh"):
        return "zh"
    if low.startswith("en"):
        return "en"
    if low.startswith("ja"):
        return "ja"
    if low.startswith("ko"):
        return "ko"
    if "yue" in low or low.startswith("zh-hk") or low.startswith("zh-tw"):
        # SenseVoice uses yue for Cantonese; zh-TW still closer to zh
        if "yue" in low or "hk" in low:
            return "yue"
        return "zh"
    if "-" in low:
        return low.split("-")[0]
    return low


class SenseVoiceEngine:
    """FunASR AutoModel wrapper for SenseVoiceSmall."""

    def __init__(
        self,
        model_dir: Path,
        device: str = "auto",
        language: Optional[str] = "zh",
    ) -> None:
        self.model_dir = Path(model_dir)
        self.device = device
        self.compute_type = "fp32"
        self.language = language
        self._model = None
        self._lock = threading.Lock()
        self.model_name = "SenseVoiceSmall"

    def load(self) -> None:
        from funasr import AutoModel

        device = self.device
        if device == "auto":
            try:
                import torch

                device = "cuda:0" if torch.cuda.is_available() else "cpu"
            except Exception:
                device = "cpu"

        if not self.model_dir.exists():
            raise FileNotFoundError(
                f"模型目录不存在: {self.model_dir}. 请先运行 scripts/download_sensevoice.py"
            )
        # SenseVoice needs config.yaml / model.pt (or similar) locally
        markers = list(self.model_dir.glob("*.pt")) + list(self.model_dir.glob("*.bin"))
        cfg = self.model_dir / "config.yaml"
        if not cfg.exists() and not markers:
            raise FileNotFoundError(
                f"模型目录不完整: {self.model_dir}（缺少 config.yaml / *.pt）。"
                "请运行 scripts/download_sensevoice.py"
            )

        logger.info("Loading SenseVoiceSmall from %s (device=%s)", self.model_dir, device)
        # disable_update: stay offline; no VAD here — server already silence-splits
        self._model = AutoModel(
            model=str(self.model_dir),
            device=device,
            disable_update=True,
            disable_log=True,
            disable_pbar=True,
        )
        self.device = device
        self.compute_type = "cuda" if str(device).startswith("cuda") else "cpu"
        logger.info("SenseVoiceSmall loaded")

    @property
    def ready(self) -> bool:
        return self._model is not None

    def transcribe(
        self,
        audio: np.ndarray,
        language: Optional[str] = None,
    ) -> str:
        if self._model is None:
            raise RuntimeError("模型未加载")
        if audio.size == 0:
            return ""
        if audio.dtype != np.float32:
            audio = audio.astype(np.float32)

        lang = _map_language(language if language is not None else self.language)

        tmp_path: Optional[Path] = None
        try:
            fd, name = tempfile.mkstemp(suffix=".wav", prefix="asr_")
            os.close(fd)
            tmp_path = Path(name)
            _write_wav(tmp_path, audio, SAMPLE_RATE)

            with self._lock:
                res = self._model.generate(
                    input=str(tmp_path),
                    language=lang,
                    use_itn=True,
                    batch_size_s=60,
                )
        finally:
            if tmp_path is not None:
                try:
                    tmp_path.unlink(missing_ok=True)
                except Exception:
                    pass

        if not res:
            return ""
        text = res[0].get("text", "") if isinstance(res[0], dict) else str(res[0])
        try:
            from funasr.utils.postprocess_utils import rich_transcription_postprocess

            text = rich_transcription_postprocess(text)
        except Exception:
            # strip common SenseVoice tags if postprocess unavailable
            for tag in (
                "<|zh|>",
                "<|en|>",
                "<|ja|>",
                "<|ko|>",
                "<|yue|>",
                "<|nospeech|>",
                "<|NEUTRAL|>",
                "<|HAPPY|>",
                "<|SAD|>",
                "<|ANGRY|>",
                "<|EMO_UNKNOWN|>",
                "<|Event_UNK|>",
                "<|Speech|>",
                "<|BGM|>",
                "<|Applause|>",
                "<|Laughter|>",
                "<|Cry|>",
            ):
                text = text.replace(tag, "")
        return text.strip()


# Back-compat alias used by older imports
WhisperEngine = SenseVoiceEngine
