FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install -r requirements.txt

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH="/app" \
    HOST=0.0.0.0 \
    PORT=8000 \
    WORKERS=2

WORKDIR /app

RUN groupadd --system app \
    && useradd --system --gid app --create-home --home-dir /home/app app \
    && mkdir -p /app/public/uploads /app/logs \
    && chown -R app:app /app

COPY --from=builder /opt/venv /opt/venv
COPY . .

USER app

EXPOSE 8000

CMD ["sh", "-c", "exec uvicorn app.main:app --host ${HOST} --port ${PORT} --workers ${WORKERS}"]
