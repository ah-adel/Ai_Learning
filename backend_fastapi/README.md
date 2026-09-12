# FastAPI Async Service

This project is a clean, dependency-isolated FastAPI application built for asynchronous request handling and strict request validation.

## Features

- Async-first API endpoints using FastAPI
- Strict Pydantic v2 validation with `BaseModel`
- Uvicorn ASGI server for production-style local development
- No imports from the existing workspace application code

## Local development

```bash
cd backend_fastapi
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## API docs

- Swagger UI: http://localhost:8000/docs
- OpenAPI JSON: http://localhost:8000/openapi.json
