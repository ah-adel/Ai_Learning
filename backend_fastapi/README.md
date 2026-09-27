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

## API authentication

Sign-up and sign-in return signed HS256 JWT access tokens. Set `JWT_SECRET_KEY` to a randomly generated value of at least 32 bytes in deployed environments. If it is unset, the service creates and reuses a private signing key at `APP_DATA_DIR/.jwt_signing_key`; keep that data directory persistent and restrict access to it. The platform's `jwt_expiration_minutes` setting controls access-token lifetime; `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` is the fallback when no valid platform value exists.

When `allowStudentSignup` is disabled, public student registration returns 403. Enabling `enforce_mfa` requires TOTP setup or verification before an access token is issued. The short-lived challenge returned by sign-up/sign-in is used with `POST /api/auth/mfa/setup` and `POST /api/auth/mfa/verify`; protected API routes reject unverified MFA tokens.

## API docs

- Swagger UI: http://localhost:8000/docs
- OpenAPI JSON: http://localhost:8000/openapi.json
