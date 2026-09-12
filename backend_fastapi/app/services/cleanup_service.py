from __future__ import annotations

import os
from pathlib import Path
from typing import Any

MEDIA_FIELD_KEYS = {
    "url",
    "videourl",
    "attachmenturl",
    "videopath",
    "attachmentpath",
    "filepath",
    "fileurl",
    "mediaurl",
    "mediafile",
    "video",
    "attachment",
    "file",
    "path",
    "src",
    "secure_url",
    "file_path",
    "video_url",
    "attachment_url",
}


def normalize_value(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def collect_candidate_urls(value: Any, seen: set[int] | None = None, results: list[str] | None = None) -> list[str]:
    if results is None:
        results = []
    if seen is None:
        seen = set()

    if value is None or not isinstance(value, (dict, list, tuple, set)):
        return results

    object_id = id(value)
    if object_id in seen:
        return results
    seen.add(object_id)

    if isinstance(value, (list, tuple, set)):
        for entry in value:
            collect_candidate_urls(entry, seen, results)
        return results

    for key, child in value.items():
        normalized_key = str(key).lower()
        if normalized_key in MEDIA_FIELD_KEYS and isinstance(child, str):
            cleaned = normalize_value(child)
            if cleaned:
                results.append(cleaned)
        if isinstance(child, (dict, list, tuple, set)):
            collect_candidate_urls(child, seen, results)
    return results


def resolve_server_storage_path(value: str | None, project_root: str | Path = ".") -> str | None:
    normalized = normalize_value(value)
    if not normalized:
        return None

    relative_path = normalized
    try:
        from urllib.parse import urlparse

        parsed = urlparse(normalized)
        if parsed.scheme and parsed.netloc:
            relative_path = parsed.path
    except Exception:
        pass

    root = Path(project_root).resolve()
    candidates = [
        root / "uploads" / relative_path.lstrip("/"),
        root / relative_path.lstrip("/"),
        root / "uploads" / Path(relative_path).name,
        root / "uploads" / "videos" / Path(relative_path).name,
        root / "uploads" / "attachments" / Path(relative_path).name,
        root / "public" / relative_path.lstrip("/"),
        root / "public" / "uploads" / Path(relative_path).name,
        root / "public" / "uploads" / "videos" / Path(relative_path).name,
        root / "public" / "uploads" / "attachments" / Path(relative_path).name,
    ]

    for candidate in candidates:
        try:
            if candidate.exists() and candidate.is_file():
                return str(candidate)
        except OSError:
            continue

    return None


def collect_entity_media_paths(entity: Any, project_root: str | Path = ".") -> list[str]:
    if entity is None or not isinstance(entity, dict):
        return []

    unique_paths: list[str] = []
    seen_paths: set[str] = set()

    for candidate in collect_candidate_urls(entity):
        server_path = resolve_server_storage_path(candidate, project_root)
        if not server_path or server_path in seen_paths:
            continue
        seen_paths.add(server_path)
        unique_paths.append(server_path)

    return unique_paths


def purge_files(file_paths: list[str]) -> tuple[list[str], list[dict[str, str]]]:
    deleted: list[str] = []
    errors: list[dict[str, str]] = []

    for raw_path in file_paths:
        try:
            absolute_path = str(Path(raw_path).resolve())
            if not os.path.exists(absolute_path):
                continue
            os.remove(absolute_path)
            deleted.append(absolute_path)
        except Exception as exc:  # pragma: no cover - defensive cleanup branch
            errors.append({"path": str(raw_path), "message": str(exc)})

    return deleted, errors


def purge_entity_references(entity: Any, database_store: dict[str, Any] | None = None) -> dict[str, Any]:
    if entity is None or not isinstance(entity, dict):
        return {"purgedCollections": [], "errors": []}

    target_id = entity.get("id") or entity.get("courseId") or entity.get("lessonId") or entity.get("moduleId") or entity.get("entityId")
    if not target_id:
        return {"purgedCollections": [], "errors": []}

    store = database_store or {}
    purged_collections: list[str] = []
    errors: list[dict[str, str]] = []

    for collection_name, collection_value in store.items():
        if not isinstance(collection_value, list):
            continue

        next_collection = []
        changed = False
        for entry in collection_value:
            if not isinstance(entry, dict):
                next_collection.append(entry)
                continue
            match_keys = ["id", "courseId", "lessonId", "moduleId", "entityId", "parentId"]
            if any(entry.get(key) == target_id for key in match_keys):
                changed = True
                continue
            next_collection.append(entry)

        if changed:
            store[collection_name] = next_collection
            purged_collections.append(collection_name)

    return {"purgedCollections": purged_collections, "errors": errors}


def cleanup_deletion_artifacts(entity: Any, project_root: str | Path = ".", database_store: dict[str, Any] | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "entityId": entity.get("id") if isinstance(entity, dict) else None,
        "deletedFiles": [],
        "purgedCollections": [],
        "errors": [],
    }

    if isinstance(entity, dict):
        result["entityId"] = entity.get("id") or entity.get("courseId") or entity.get("lessonId") or entity.get("moduleId") or None

    try:
        paths = collect_entity_media_paths(entity, project_root)
        deleted, errors = purge_files(paths)
        result["deletedFiles"] = deleted
        result["errors"].extend(errors)
    except Exception as exc:  # pragma: no cover - defensive cleaning branch
        result["errors"].append({"message": str(exc), "path": None})

    try:
        db_result = purge_entity_references(entity, database_store)
        result["purgedCollections"] = db_result["purgedCollections"]
        result["errors"].extend(db_result["errors"])
    except Exception as exc:  # pragma: no cover - defensive DB cleanup branch
        result["errors"].append({"message": str(exc), "path": None})

    return result
