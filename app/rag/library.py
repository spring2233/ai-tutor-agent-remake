"""Persist uploaded PDFs and a small JSON catalog for the bookshelf."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

LIBRARY_DIR = Path("uploads")
_ID_RE = re.compile(r"^[a-f0-9]{12}$")


def new_document_id() -> str:
    return uuid.uuid4().hex[:12]


def _catalog_path() -> Path:
    return LIBRARY_DIR / "catalog.json"


def pdf_path(document_id: str) -> Path:
    if not _ID_RE.fullmatch(document_id or ""):
        raise ValueError("Invalid document id")
    return LIBRARY_DIR / f"{document_id}.pdf"


def units_path(document_id: str) -> Path:
    if not _ID_RE.fullmatch(document_id or ""):
        raise ValueError("Invalid document id")
    return LIBRARY_DIR / f"{document_id}.units.json"


def save_knowledge_units(document_id: str, units: list[dict]) -> None:
    path = units_path(document_id)
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"units": units}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_knowledge_units(document_id: str) -> list[dict] | None:
    try:
        path = units_path(document_id)
    except ValueError:
        return None
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    units = data.get("units") if isinstance(data, dict) else data
    return units if isinstance(units, list) else None


def _read_catalog() -> list[dict]:
    path = _catalog_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    documents = data.get("documents", [])
    return documents if isinstance(documents, list) else []


def _write_catalog(documents: list[dict]) -> None:
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    _catalog_path().write_text(
        json.dumps({"documents": documents}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def list_documents() -> list[dict]:
    return _read_catalog()


def get_document(document_id: str) -> dict | None:
    try:
        pdf_path(document_id)
    except ValueError:
        return None
    for record in _read_catalog():
        if record.get("id") == document_id:
            return record
    return None


def save_pdf(
    document_id: str,
    content: bytes,
    name: str,
    pages: int,
    chunks: int,
    meta: dict | None = None,
) -> dict:
    path = pdf_path(document_id)
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    record = {
        "id": document_id,
        "name": name,
        "pages": pages,
        "chunks": chunks,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    if isinstance(meta, dict):
        for key in ("planetName", "themeCategory", "themeSummary"):
            val = meta.get(key)
            if isinstance(val, str) and val.strip():
                record[key] = val.strip()
    try:
        documents = [
            item for item in _read_catalog() if item.get("id") != document_id
        ]
        documents.insert(0, record)
        _write_catalog(documents)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return record


def update_document_meta(document_id: str, meta: dict) -> dict | None:
    if not isinstance(meta, dict):
        return get_document(document_id)
    documents = _read_catalog()
    updated: dict | None = None
    for item in documents:
        if item.get("id") == document_id:
            for key in ("planetName", "themeCategory", "themeSummary"):
                val = meta.get(key)
                if isinstance(val, str) and val.strip():
                    item[key] = val.strip()
            updated = item
            break
    if updated is not None:
        _write_catalog(documents)
    return updated


def remove_stored_document(document_id: str) -> bool:
    record = get_document(document_id)
    path = pdf_path(document_id)
    if path.exists():
        path.unlink()
    try:
        extra = units_path(document_id)
    except ValueError:
        extra = None
    if extra is not None and extra.exists():
        extra.unlink()
    documents = [
        item for item in _read_catalog() if item.get("id") != document_id
    ]
    _write_catalog(documents)
    return record is not None
