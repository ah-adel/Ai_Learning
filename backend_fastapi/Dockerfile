FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY backend_fastapi/requirements.txt ./
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
    && mkdir -p /app/data /app/uploads /app/logs /app/public/uploads /app/database \
    && chown -R app:app /app/data /app/uploads /app/logs /app/public/uploads

COPY --from=builder /opt/venv /opt/venv
COPY backend_fastapi/. ./
COPY database ./database
COPY backend_fastapi/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER root

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["sh", "-c", "exec uvicorn app.main:app --host ${HOST} --port ${PORT} --workers ${WORKERS}"]
