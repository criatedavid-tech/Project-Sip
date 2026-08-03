from __future__ import annotations

import math
import os
import tempfile
import threading
from importlib.metadata import version
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel


MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
MODEL_CACHE = os.getenv("WHISPER_MODEL_CACHE", "/models")
CPU_THREADS = int(os.getenv("WHISPER_CPU_THREADS", "0"))
BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "5"))
MAX_UPLOAD_BYTES = int(os.getenv("WHISPER_MAX_UPLOAD_MB", "250")) * 1024 * 1024

app = FastAPI(title="Omni Local Whisper", version="1.0.0")
_model: WhisperModel | None = None
_model_lock = threading.Lock()
_transcription_lock = threading.Lock()


def get_model() -> WhisperModel:
    global _model
    if _model is not None:
        return _model

    with _model_lock:
        if _model is None:
            Path(MODEL_CACHE).mkdir(parents=True, exist_ok=True)
            _model = WhisperModel(
                MODEL_NAME,
                device=DEVICE,
                compute_type=COMPUTE_TYPE,
                download_root=MODEL_CACHE,
                cpu_threads=CPU_THREADS,
            )
    return _model


def persist_upload(upload: UploadFile) -> str:
    suffix = Path(upload.filename or "audio.wav").suffix or ".wav"
    temporary = tempfile.NamedTemporaryFile(
        mode="wb", suffix=suffix, prefix="omni-whisper-", delete=False
    )
    total = 0
    try:
        with temporary:
            while chunk := upload.file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="audio muito grande")
                temporary.write(chunk)
    except Exception:
        Path(temporary.name).unlink(missing_ok=True)
        raise

    if total == 0:
        Path(temporary.name).unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="audio vazio")
    return temporary.name


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "model_loaded": _model is not None,
    }


@app.post("/v1/transcriptions")
def transcribe(
    file: Annotated[UploadFile, File(...)],
    language: Annotated[str, Form()] = "pt",
    idempotency_key: Annotated[str | None, Form()] = None,
) -> dict[str, object]:
    del idempotency_key  # A persistência/idempotência é controlada pelo worker.
    audio_path = persist_upload(file)
    try:
        with _transcription_lock:
            segments_generator, info = get_model().transcribe(
                audio_path,
                language=language or None,
                beam_size=BEAM_SIZE,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 500},
                condition_on_previous_text=False,
            )
            segments = []
            full_text = []
            for segment in segments_generator:
                text = segment.text.strip()
                if not text:
                    continue
                confidence = math.exp(min(0.0, float(segment.avg_logprob)))
                segments.append(
                    {
                        "start": round(float(segment.start), 3),
                        "end": round(float(segment.end), 3),
                        "text": text,
                        "confidence": round(confidence, 4),
                    }
                )
                full_text.append(text)

        return {
            "text": " ".join(full_text),
            "language": info.language,
            "duration": info.duration,
            "model": MODEL_NAME,
            "version": version("faster-whisper"),
            "segments": segments,
        }
    finally:
        Path(audio_path).unlink(missing_ok=True)
