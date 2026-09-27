from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

MEDIA_FIELD_KEYS = {
    "url",
    "thumbnailurl",
    "thumbnail_url",
    "avatar",
    "avatarurl",
    "avatar_url",
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


def storage_snapshot(upload_root: str | Path) -> dict[str, Any]:
    root = Path(upload_root).resolve()
    result: dict[str, Any] = {"videos": {"bytes": 0, "files": 0}, "attachments": {"bytes": 0, "files": 0}}
    for folder in result:
        directory = root / folder
        if not directory.exists():
            continue
        for path in directory.rglob("*"):
            if path.is_file():
                result[folder]["bytes"] += path.stat().st_size
                result[folder]["files"] += 1
    return result


def purge_temp_storage(upload_root: str | Path, max_age_hours: int = 24) -> dict[str, Any]:
    root = Path(upload_root).resolve()
    cutoff = __import__("time").time() - max_age_hours * 3600
    deleted: list[str] = []
    errors: list[dict[str, str]] = []
    temp_candidates = list(root.rglob("*.tmp")) + list(root.rglob("*.part"))
    for path in temp_candidates:
        try:
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink()
                deleted.append(str(path))
        except OSError as exc:
            errors.append({"path": str(path), "message": str(exc)})
    return {"deleted_files": deleted, "errors": errors, "storage": storage_snapshot(root)}


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


def _resolve_upload_root(upload_root: str | Path) -> Path:
    return Path(upload_root).expanduser().resolve()


def resolve_server_storage_path(value: str | None, project_root: str | Path = "uploads") -> str | None:
    normalized = normalize_value(value)
    if not normalized:
        return None

    parsed = urlparse(normalized)
    relative_path = unquote(parsed.path if parsed.scheme or parsed.netloc else normalized)
    relative_path = relative_path.replace("\\", "/").split("?", 1)[0].split("#", 1)[0]
    if relative_path.startswith("/uploads/"):
        relative_path = relative_path[len("/uploads/"):]
    elif relative_path.startswith("uploads/"):
        relative_path = relative_path[len("uploads/"):]
    elif relative_path.startswith(("videos/", "attachments/", "thumbnails/")):
        pass
    elif "/" not in relative_path and relative_path not in {"", ".", ".."}:
        root = _resolve_upload_root(project_root)
        for folder in ("videos", "attachments", "thumbnails"):
            candidate_path = (root / folder / relative_path).resolve()
            if _is_within(candidate_path, root) and candidate_path.is_file():
                return str(candidate_path)
        return None
    else:
        return None

    parts = Path(relative_path).parts
    if not relative_path or any(part in {"", ".", ".."} for part in parts):
        return None

    root = _resolve_upload_root(project_root)
    candidate = (root / relative_path).resolve()
    if not _is_within(candidate, root):
        return None
    try:
        if candidate.is_file():
            return str(candidate)
    except OSError:
        return None
    return None


def _is_within(candidate: Path, root: Path) -> bool:
    try:
        candidate.relative_to(root)
        return candidate != root
    except ValueError:
        return False


def collect_entity_media_paths(entity: Any, project_root: str | Path = "uploads") -> list[str]:
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


def purge_files(file_paths: list[str], upload_root: str | Path | None = None) -> tuple[list[str], list[dict[str, str]]]:
    deleted: list[str] = []
    errors: list[dict[str, str]] = []
    root = _resolve_upload_root(upload_root) if upload_root is not None else None

    for raw_path in file_paths:
        try:
            absolute_path = str(Path(raw_path).resolve())
            if root is not None and not _is_within(Path(absolute_path), root):
                errors.append({"path": str(raw_path), "message": "Resolved path is outside the uploads directory."})
                continue
            if not os.path.exists(absolute_path):
                continue
            os.remove(absolute_path)
            deleted.append(absolute_path)
        except Exception as exc:  # pragma: no cover - defensive cleanup branch
            errors.append({"path": str(raw_path), "message": str(exc)})

    return deleted, errors


def purge_orphaned_files(referenced_urls: list[str], upload_root: str | Path) -> dict[str, Any]:
    root = _resolve_upload_root(upload_root)
    referenced_paths = {
        Path(path).resolve()
        for url in referenced_urls
        if (path := resolve_server_storage_path(url, root)) is not None
    }
    candidates: list[str] = []
    errors: list[dict[str, str]] = []

    if root.exists():
        for path in root.rglob("*"):
            try:
                if path.is_symlink() or not path.is_file():
                    continue
                resolved = path.resolve()
                if not _is_within(resolved, root):
                    errors.append({"path": str(path), "message": "Resolved path is outside the uploads directory."})
                    continue
                if resolved not in referenced_paths:
                    candidates.append(str(resolved))
            except OSError as exc:
                errors.append({"path": str(path), "message": str(exc)})

    deleted, purge_errors = purge_files(candidates, upload_root=root)
    errors.extend(purge_errors)
    return {"deleted_files": deleted, "errors": errors}


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


def cleanup_deletion_artifacts(entity: Any, project_root: str | Path = "uploads", database_store: dict[str, Any] | None = None) -> dict[str, Any]:
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
        upload_root = _resolve_upload_root(project_root)
        deleted, errors = purge_files(paths, upload_root=upload_root)
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
