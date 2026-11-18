from unittest.mock import MagicMock

from langchain_core.documents import Document

from app.rag.document_context import (
    SOURCE_CHAR_BUDGET,
    assemble_context,
    is_overview_question,
)
from app.rag.vector_store import get_ordered_chunks


def _chunk(index: int, text: str) -> Document:
    return Document(
        page_content=text,
        metadata={"chunk_index": index, "source": "paper.pdf", "page": index + 1},
    )


def _unit(name: str = "Fast-WAM") -> dict:
    return {
        "name": name,
        "statement": f"{name} is the model under test.",
        "prerequisites": [],
        "plain": "一个更快的模型",
    }


def test_user_overview_question_is_detected():
    assert is_overview_question("告诉我这份pdf主要讲解了哪些知识，insight是什么")
    assert is_overview_question("Summarize this paper")
    assert not is_overview_question("Spatial 分数是多少？")
    assert not is_overview_question("pdf 里的公式 (3) 是什么")


def test_overview_includes_the_whole_document_not_only_hits():
    chunks = [_chunk(index, f"SECTION-{index}-" + ("x" * 40)) for index in range(6)]
    retrieved = [
        Document(
            page_content="ONLY-HIT-FRAGMENT",
            metadata={"chunk_index": 3, "source": "paper.pdf", "relevance_score": 0.8},
        )
    ]

    docs = assemble_context(
        "告诉我这份pdf主要讲解了哪些知识，insight是什么",
        retrieved,
        [_unit()],
        chunks,
        document_id="abc123abc123",
    )
    text = "\n".join(doc.page_content for doc in docs)

    assert "【全书知识地图】" in text
    assert "【原文覆盖】" in text
    assert "已全部包含" in text
    assert "ONLY-HIT-FRAGMENT" not in text
    for index in range(6):
        assert f"SECTION-{index}-" in text
    assert docs[0].metadata["role"] == "knowledge_map"
    assert docs[0].metadata["source"] == "paper.pdf"
    coverage = next(doc for doc in docs if doc.metadata["role"] == "document_coverage")
    assert coverage.metadata["complete"] is True


def test_long_document_still_reaches_the_last_section():
    chunks = [
        _chunk(index, f"CHUNK-{index:03d}-" + ("z" * 1000))
        for index in range(130)
    ]
    assert sum(len(chunk.page_content) for chunk in chunks) > SOURCE_CHAR_BUDGET

    docs = assemble_context(
        "总结这份pdf的洞察",
        [],
        [_unit()],
        chunks,
        document_id="abc123abc123",
    )
    text = "\n".join(doc.page_content for doc in docs)

    assert "CHUNK-000-" in text
    assert "CHUNK-129-" in text
    assert "均匀截取" in text
    coverage = next(doc for doc in docs if doc.metadata["role"] == "document_coverage")
    assert coverage.metadata["complete"] is False


def test_specific_question_keeps_hits_and_map_without_dumping_the_pdf():
    chunks = [_chunk(0, "FULL-DOCUMENT-BODY")]
    retrieved = [
        Document(
            page_content="ONLY_HIT",
            metadata={"relevance_score": 0.8, "chunk_index": 4, "source": "paper.pdf"},
        )
    ]

    docs = assemble_context(
        "Spatial 分数是多少",
        retrieved,
        [_unit()],
        chunks,
        document_id="abc123abc123",
    )
    text = "\n".join(doc.page_content for doc in docs)

    assert "【全书知识地图】" in text
    assert "ONLY_HIT" in text
    assert "FULL-DOCUMENT-BODY" not in text
    assert any(doc.metadata.get("relevance_score") == 0.8 for doc in docs)


def test_overview_without_stored_text_keeps_the_hits():
    hit = Document(page_content="hit", metadata={"source": "a.pdf"})
    docs = assemble_context("总结这份pdf", [hit], None, [], document_id="abc")
    assert docs == [hit]


def test_get_ordered_chunks_sorts_by_index(monkeypatch):
    store = MagicMock()
    store.get.return_value = {
        "documents": ["second", "first"],
        "metadatas": [
            {"chunk_index": 1, "document_id": "abc"},
            {"chunk_index": 0, "document_id": "abc"},
        ],
    }
    monkeypatch.setattr("app.rag.vector_store.get_vectorstore", lambda: store)

    docs = get_ordered_chunks("abc123abc123")

    assert [doc.page_content for doc in docs] == ["first", "second"]
    store.get.assert_called_once()
