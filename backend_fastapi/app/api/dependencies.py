from __future__ import annotations

from typing import Any


def get_database_store() -> dict[str, Any]:
    return {
        "courses": [],
        "modules": [],
        "lessons": [],
        "enrollments": [],
        "users": [],
    }
