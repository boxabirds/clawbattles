"""
Minimal TTS HTTP service wrapping KittenTTS.

POST /synthesize  { "text": "...", "voice": "..." }  -> WAV audio bytes
GET  /voices      -> list of available voice names
GET  /health      -> { "status": "ok" }
"""

import io
import logging
from contextlib import asynccontextmanager
from typing import Optional

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from kittentts import KittenTTS
from pydantic import BaseModel

logger = logging.getLogger("tts-server")
logging.basicConfig(level=logging.INFO)

# -- Constants --
MODEL_ID = "KittenML/kitten-tts-nano-0.8"
SAMPLE_RATE = 24000
DEFAULT_VOICE = "Bella"
AVAILABLE_VOICES = ["Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo"]

# -- Model singleton --
model: Optional[KittenTTS] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup."""
    global model
    logger.info("Loading KittenTTS model: %s", MODEL_ID)
    model = KittenTTS(MODEL_ID)
    logger.info("Model loaded successfully")
    yield
    logger.info("Shutting down")


app = FastAPI(title="KittenTTS Service", lifespan=lifespan)

# Allow CORS from any origin (dev tool, not production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SynthesizeRequest(BaseModel):
    text: str
    voice: str = DEFAULT_VOICE


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_ID}


@app.get("/voices")
async def voices():
    return {"voices": AVAILABLE_VOICES}


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    if req.voice not in AVAILABLE_VOICES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice '{req.voice}'. Available: {AVAILABLE_VOICES}",
        )

    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text must not be empty")

    logger.info("Synthesizing: voice=%s text=%r", req.voice, req.text[:80])

    try:
        audio = model.generate(req.text, voice=req.voice)
    except Exception as e:
        logger.error("Synthesis failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}")

    # RMS loudness normalization then peak-limit
    TARGET_DB = -3.0
    NOISE_FLOOR = 1e-6
    rms = np.sqrt(np.mean(audio ** 2))
    if rms > NOISE_FLOOR:
        target_rms = 10 ** (TARGET_DB / 20.0)
        audio = audio * (target_rms / rms)
        # Hard-clip to prevent overs
        audio = np.clip(audio, -1.0, 1.0)

    # Encode as WAV into memory buffer
    buf = io.BytesIO()
    sf.write(buf, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    buf.seek(0)

    return Response(
        content=buf.read(),
        media_type="audio/wav",
        headers={"Content-Disposition": 'attachment; filename="tts_output.wav"'},
    )
