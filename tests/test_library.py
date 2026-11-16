import json
from unittest.mock import MagicMock

import pytest

from app.rag import library
from app.ui import backend


def test_save_list_and_remove_pdf(tmp_path, monkeypatch):
    monkeypatch.setattr(library, "LIBRARY_DIR", tmp_path)

    record = library.save_pdf(
        document_id="abc123def456",
        content=b"%PDF-1.4 test",
        name="notes.pdf",
        pages=3,
        chunks=8,
    )

    assert record["name"] == "notes.pdf"
    assert library.pdf_path("abc123def456").read_bytes() == b"%PDF-1.4 test"
    assert library.list_documents()[0]["id"] == "abc123def456"
    assert library.remove_stored_document("abc123def456") is True
    assert library.list_documents() == []
    assert not library.pdf_path("abc123def456").exists()


def test_reject_unsafe_document_id():
    with pytest.raises(ValueError):
        library.pdf_path("../secret")


def test_ingest_document_keeps_pdf(tmp_path, monkeypatch):
    monkeypatch.setattr(library, "LIBRARY_DIR", tmp_path)
    monkeypatch.setattr(library, "new_document_id", lambda: "abc123def456")
    monkeypatch.setattr(backend, "new_document_id", lambda: "abc123def456")

    page = MagicMock()
    monkeypatch.setattr(backend, "parse_pdf_bytes", lambda content, source_name: [page])
    monkeypatch.setattr(backend, "chunk_pages", lambda **kwargs: ["chunk"])
    monkeypatch.setattr(backend, "add_chunks", lambda chunks: None)

    uploaded = MagicMock()
    uploaded.name = "notes.pdf"
    uploaded.getvalue.return_value = b"%PDF-1.4 notes"

    result = backend.ingest_document(uploaded)

    assert result["status"] == "ok"
    assert result["document_id"] == "abc123def456"
    assert result["name"] == "notes.pdf"
    assert result["pages"] == 1
    stored = json.loads((tmp_path / "catalog.json").read_text(encoding="utf-8"))
    assert stored["documents"][0]["name"] == "notes.pdf"
    assert (tmp_path / "abc123def456.pdf").read_bytes() == b"%PDF-1.4 notes"


def test_normalize_memory_pairs_drops_duplicates():
    raw = [
        {"term": "Process", "definition": "A program in execution."},
        {"term": "process", "definition": "Duplicate casing."},
        {"term": "Thread", "definition": "Thread"},
        {"term": "Thread", "definition": "A unit of execution inside a process."},
    ]

    pairs = backend._normalize_memory_pairs(raw, 2)

    assert pairs == [
        {"term": "Process", "definition": "A program in execution."},
        {"term": "Thread", "definition": "A unit of execution inside a process."},
    ]


def test_generate_memory_pairs_retries_once(tmp_path, monkeypatch):
    monkeypatch.setattr(library, "LIBRARY_DIR", tmp_path)
    library.save_pdf("abc123def456", b"%PDF", "notes.pdf", 1, 1)
    monkeypatch.setattr(
        backend,
        "get_all_chunks_for_document",
        lambda document_id: ["Processes and threads."],
    )

    good = json.dumps([
        {"term": "Process", "definition": "A program in execution."},
    ])
    response = MagicMock()
    calls = {"n": 0}

    class FakeLLM:
        def invoke(self, _prompt):
            calls["n"] += 1
            response.content = "not json" if calls["n"] == 1 else good
            return response

    monkeypatch.setattr(backend, "llm", FakeLLM())
    monkeypatch.setattr(backend, "extract_text", lambda item: item.content)

    pairs = backend.generate_memory_pairs("abc123def456", pair_count=1)

    assert calls["n"] == 2
    assert pairs[0]["term"] == "Process"
