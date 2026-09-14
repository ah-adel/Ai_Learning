#!/bin/sh
set -eu

mkdir -p /app/data /app/uploads /app/logs /app/public/uploads
chown -R app:app /app/data /app/uploads /app/logs /app/public/uploads

exec su app -s /bin/sh -c 'exec uvicorn app.main:app --host "$HOST" --port "$PORT" --workers "$WORKERS"'
