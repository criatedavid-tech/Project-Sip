FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models \
    XDG_CACHE_HOME=/models

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt

RUN useradd --create-home --uid 10001 whisper \
    && mkdir -p /models /tmp/whisper \
    && chown -R whisper:whisper /models /tmp/whisper /app

COPY --chown=whisper:whisper app.py ./

USER whisper
EXPOSE 8090

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1"]
