"""
Offline voice STT server: mic PCM over WebSocket → silence-gap sentences → SenseVoice-Small.

Continuous mode: mic PCM is always assembled while listening; completed utterances are
queued and recognized in a background worker so recording never blocks on ASR.

Protocol (JSON text frames + binary PCM):
  Client → Server:
    binary: Int16 little-endian mono PCM @ 16 kHz
    text JSON:
      {"type":"start","lang":"zh-CN","silence_ms":1000}
      {"type":"stop","finalize":true}
      {"type":"abort"}
      {"type":"ping"}
  Server → Client JSON:
      {"type":"status","status":"listening|processing|idle|error","detail":"..."}
      {"type":"partial","text":"...","is_final":false}
      {"type":"final","text":"...","duration_ms":1234}
      {"type":"error","message":"...","code":"timeout|...","duration_ms":...}
      {"type":"ready","model":"...","device":"...","asr_timeout_sec":90}
      {"type":"pong"}
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import deque
from pathlib import Path
from typing import Deque, Optional

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from asr_engine import SAMPLE_RATE, SenseVoiceEngine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("server")

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = Path(os.environ.get("SENSEVOICE_MODEL_DIR", ROOT / "models" / "SenseVoiceSmall"))
STATIC_DIR = ROOT / "static"
DEFAULT_SILENCE_MS = int(os.environ.get("SILENCE_MS", "1000"))
# Energy VAD thresholds (Int16 abs mean)
SPEECH_THRESH = float(os.environ.get("SPEECH_THRESH", "350"))
MIN_SPEECH_MS = int(os.environ.get("MIN_SPEECH_MS", "280"))
MAX_UTTERANCE_MS = int(os.environ.get("MAX_UTTERANCE_MS", "30000"))
# Max wall time for one ASR call (seconds). Configurable via ASR_TIMEOUT_SEC.
ASR_TIMEOUT_SEC = float(os.environ.get("ASR_TIMEOUT_SEC", "90"))
# Pending utterance queue while ASR is busy (prefer short segments; drop oldest if full).
MAX_PENDING_UTTERANCES = int(os.environ.get("MAX_PENDING_UTTERANCES", "8"))

app = FastAPI(title="Voice STT Offline", version="1.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = SenseVoiceEngine(MODEL_DIR)


@app.on_event("startup")
def _startup() -> None:
    engine.load()


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "ready": engine.ready,
        "model": engine.model_name,
        "model_dir": str(MODEL_DIR),
        "device": engine.device,
        "compute_type": engine.compute_type,
        "asr_timeout_sec": ASR_TIMEOUT_SEC,
        "silence_ms_default": DEFAULT_SILENCE_MS,
        "max_pending_utterances": MAX_PENDING_UTTERANCES,
        "continuous": True,
        "offline": True,
    }


class UtteranceAssembler:
    """Silence-gap sentence splitter on streaming PCM."""

    def __init__(self, silence_ms: int = DEFAULT_SILENCE_MS) -> None:
        self.silence_ms = silence_ms
        self.reset()

    def reset(self) -> None:
        self.buf = np.zeros(0, dtype=np.float32)
        self.in_speech = False
        self.silence_samples = 0
        self.speech_samples = 0
        self.utterance = []  # list of float32 arrays

    def _rms_int16(self, pcm: np.ndarray) -> float:
        if pcm.size == 0:
            return 0.0
        return float(np.mean(np.abs(pcm.astype(np.float32))))

    def feed(self, pcm_i16: np.ndarray) -> list[np.ndarray]:
        """Feed Int16 PCM; return list of completed utterances (float32)."""
        completed: list[np.ndarray] = []
        if pcm_i16.size == 0:
            return completed

        energy = self._rms_int16(pcm_i16)
        is_speech = energy >= SPEECH_THRESH
        audio_f = pcm_i16.astype(np.float32) / 32768.0

        if is_speech:
            self.in_speech = True
            self.silence_samples = 0
            self.speech_samples += pcm_i16.size
            self.utterance.append(audio_f)
            dur_ms = 1000.0 * sum(a.size for a in self.utterance) / SAMPLE_RATE
            if dur_ms >= MAX_UTTERANCE_MS:
                completed.append(self._flush())
        else:
            if self.in_speech:
                self.utterance.append(audio_f)
                self.silence_samples += pcm_i16.size
                silence_ms = 1000.0 * self.silence_samples / SAMPLE_RATE
                speech_ms = 1000.0 * self.speech_samples / SAMPLE_RATE
                if silence_ms >= self.silence_ms and speech_ms >= MIN_SPEECH_MS:
                    completed.append(self._flush())
        return completed

    def _flush(self) -> np.ndarray:
        if not self.utterance:
            out = np.zeros(0, dtype=np.float32)
        else:
            out = np.concatenate(self.utterance)
        self.in_speech = False
        self.silence_samples = 0
        self.speech_samples = 0
        self.utterance = []
        return out

    def finalize(self) -> Optional[np.ndarray]:
        speech_ms = 1000.0 * self.speech_samples / SAMPLE_RATE
        if self.utterance and speech_ms >= MIN_SPEECH_MS:
            return self._flush()
        self.reset()
        return None


@app.websocket("/ws/asr")
async def ws_asr(ws: WebSocket):
    await ws.accept()
    lang = "zh"
    silence_ms = DEFAULT_SILENCE_MS
    assembler = UtteranceAssembler(silence_ms)
    listening = False
    busy = False
    abort_flag = False
    pending: Deque[np.ndarray] = deque()
    wake = asyncio.Event()
    worker_task: Optional[asyncio.Task] = None
    stop_worker = False

    async def send(obj: dict) -> None:
        try:
            await ws.send_text(json.dumps(obj, ensure_ascii=False))
        except Exception:
            pass

    await send(
        {
            "type": "ready",
            "model": MODEL_DIR.name,
            "device": engine.device,
            "compute_type": engine.compute_type,
            "silence_ms": silence_ms,
            "asr_timeout_sec": ASR_TIMEOUT_SEC,
            "continuous": True,
            "max_pending": MAX_PENDING_UTTERANCES,
        }
    )

    loop = asyncio.get_event_loop()

    def enqueue_utterance(audio: np.ndarray) -> None:
        """Queue a completed utterance; drop oldest if full (prefer keeping newer short turns)."""
        if audio.size == 0:
            return
        while len(pending) >= MAX_PENDING_UTTERANCES:
            dropped = pending.popleft()
            logger.warning(
                "ASR queue full (max=%d), dropped oldest utterance (%.2fs)",
                MAX_PENDING_UTTERANCES,
                dropped.size / SAMPLE_RATE,
            )
        pending.append(audio)
        wake.set()

    def clear_pending() -> None:
        pending.clear()
        wake.set()

    async def process_utterance(audio: np.ndarray) -> None:
        nonlocal busy, abort_flag
        if audio.size == 0:
            return
        if abort_flag:
            return
        busy = True
        qleft = len(pending)
        detail = "识别中，继续聆听…" if listening else "正在识别…"
        if qleft:
            detail = f"识别中（排队 {qleft}）· 继续聆听…"
        await send({"type": "status", "status": "processing", "detail": detail})
        await send({"type": "partial", "text": "正在识别…", "is_final": False})
        t0 = time.perf_counter()
        duration_ms = 0
        text = ""
        timed_out = False
        try:
            text = await asyncio.wait_for(
                loop.run_in_executor(None, engine.transcribe, audio, lang),
                timeout=ASR_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError:
            timed_out = True
            duration_ms = int(round((time.perf_counter() - t0) * 1000))
            logger.error(
                "ASR TIMEOUT after %.1fs (limit=%ss, audio=%.2fs)",
                duration_ms / 1000.0,
                ASR_TIMEOUT_SEC,
                audio.size / SAMPLE_RATE,
            )
            await send(
                {
                    "type": "error",
                    "code": "timeout",
                    "message": (
                        f"识别超时（超过 {int(ASR_TIMEOUT_SEC)} 秒仍未返回）。"
                        "可能模型卡住或本机负载过高，请重试；"
                        f"也可在启动前设置环境变量 ASR_TIMEOUT_SEC（当前 {ASR_TIMEOUT_SEC:g}）。"
                    ),
                    "duration_ms": duration_ms,
                }
            )
            text = ""
        except Exception as e:
            logger.exception("transcribe failed")
            duration_ms = int(round((time.perf_counter() - t0) * 1000))
            await send(
                {
                    "type": "error",
                    "code": "asr_error",
                    "message": f"识别失败: {e}",
                    "duration_ms": duration_ms,
                }
            )
            text = ""
        else:
            duration_ms = int(round((time.perf_counter() - t0) * 1000))
            logger.info("ASR done in %d ms (audio=%.2fs)", duration_ms, audio.size / SAMPLE_RATE)
        busy = False
        if abort_flag:
            abort_flag = False
            await send({"type": "status", "status": "listening" if listening else "idle"})
            return
        if text:
            await send({"type": "final", "text": text, "duration_ms": duration_ms})
        else:
            await send(
                {
                    "type": "partial",
                    "text": "",
                    "is_final": False,
                    "duration_ms": duration_ms,
                }
            )
        # Stay in continuous session after per-segment timeout/error
        if listening:
            qleft = len(pending)
            if qleft or busy:
                await send(
                    {
                        "type": "status",
                        "status": "processing",
                        "detail": f"识别中（排队 {qleft}）· 继续聆听…",
                    }
                )
            else:
                detail = "聆听中（连续识别 · 静音断句）"
                if timed_out:
                    detail = "聆听中（上一段超时，可继续说）"
                await send({"type": "status", "status": "listening", "detail": detail})
        else:
            await send({"type": "status", "status": "idle", "detail": ""})

    async def asr_worker() -> None:
        """Drain pending utterances without blocking the WebSocket receive loop."""
        while True:
            while not pending and not stop_worker:
                wake.clear()
                try:
                    await asyncio.wait_for(wake.wait(), timeout=0.5)
                except asyncio.TimeoutError:
                    pass
            if stop_worker and not pending:
                break
            if abort_flag:
                clear_pending()
                continue
            if not pending:
                continue
            utt = pending.popleft()
            try:
                await process_utterance(utt)
            except Exception:
                logger.exception("asr_worker utterance failed")

    worker_task = asyncio.create_task(asr_worker())

    async def wait_queue_idle(timeout: float = 120.0) -> None:
        """Wait until pending is empty and ASR not busy (used on stop finalize)."""
        deadline = time.perf_counter() + timeout
        while time.perf_counter() < deadline:
            if not pending and not busy:
                return
            await asyncio.sleep(0.05)

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if "bytes" in msg and msg["bytes"] is not None:
                if not listening:
                    continue
                # Always assemble PCM while listening — never drop audio because ASR is busy.
                raw = msg["bytes"]
                if len(raw) < 2:
                    continue
                pcm = np.frombuffer(raw, dtype=np.int16)
                completed = assembler.feed(pcm)
                for utt in completed:
                    if abort_flag:
                        break
                    enqueue_utterance(utt)
                continue

            data = msg.get("text")
            if not data:
                continue
            try:
                obj = json.loads(data)
            except json.JSONDecodeError:
                await send({"type": "error", "message": "无效 JSON"})
                continue

            mtype = obj.get("type")
            if mtype == "ping":
                await send(
                    {
                        "type": "pong",
                        "t": time.time(),
                        "busy": busy,
                        "pending": len(pending),
                        "listening": listening,
                    }
                )
            elif mtype == "start":
                lang = obj.get("lang") or "zh"
                silence_ms = int(obj.get("silence_ms") or DEFAULT_SILENCE_MS)
                assembler = UtteranceAssembler(silence_ms)
                clear_pending()
                listening = True
                abort_flag = False
                await send(
                    {
                        "type": "status",
                        "status": "listening",
                        "detail": f"连续聆听中（静音 {silence_ms} ms 断句 · SenseVoice-Small）",
                    }
                )
            elif mtype == "stop":
                listening = False
                finalize = bool(obj.get("finalize", True))
                if finalize:
                    leftover = assembler.finalize()
                    if leftover is not None and leftover.size:
                        enqueue_utterance(leftover)
                    await wait_queue_idle(timeout=ASR_TIMEOUT_SEC + 30)
                else:
                    assembler.reset()
                    clear_pending()
                await send({"type": "status", "status": "idle"})
            elif mtype == "abort":
                abort_flag = True
                assembler.reset()
                clear_pending()
                listening = False
                await send({"type": "partial", "text": "", "is_final": False})
                await send({"type": "status", "status": "idle", "detail": "已打断并丢弃"})
            else:
                await send({"type": "error", "message": f"未知消息类型: {mtype}"})
    except WebSocketDisconnect:
        logger.info("client disconnected")
    except Exception:
        logger.exception("ws error")
        try:
            await send({"type": "error", "message": "连接异常"})
        except Exception:
            pass
    finally:
        listening = False
        stop_worker = True
        clear_pending()
        wake.set()
        if worker_task is not None:
            try:
                await asyncio.wait_for(worker_task, timeout=2.0)
            except Exception:
                worker_task.cancel()


if (STATIC_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")


@app.get("/")
def index():
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {
        "message": "static UI missing; open frontend via npm run dev or rebuild static/",
        "health": "/api/health",
    }


@app.get("/favicon.svg")
def favicon():
    path = STATIC_DIR / "favicon.svg"
    if path.exists():
        return FileResponse(path)
    return FileResponse(STATIC_DIR / "index.html") if (STATIC_DIR / "index.html").exists() else {"ok": False}


def main():
    import uvicorn

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8765"))
    uvicorn.run("main:app", host=host, port=port, reload=False, app_dir=str(Path(__file__).parent))


if __name__ == "__main__":
    main()
