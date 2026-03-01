FROM python:3.12-slim

# espeak-ng is required by kittentts for phonemization
RUN apt-get update && \
    apt-get install -y --no-install-recommends espeak-ng libsndfile1 && \
    rm -rf /var/lib/apt/lists/*

# Install uv for fast dependency resolution
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Install kittentts and FastAPI server dependencies
RUN uv pip install --system --no-cache \
    "https://github.com/KittenML/KittenTTS/releases/download/0.8.1/kittentts-0.8.1-py3-none-any.whl" \
    fastapi \
    "uvicorn[standard]" \
    soundfile

COPY server.py .

EXPOSE 5100

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "5100"]
