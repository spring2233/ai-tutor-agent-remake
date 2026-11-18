from unittest.mock import MagicMock

from langchain_core.documents import Document

from app.ui import backend


# ============================================================
# HELPERS
# ============================================================

def make_rag_document(score=0.75):
    return Document(
        page_content="Quantum computing uses qubits and quantum gates.",
        metadata={
            "document_id": "research_report.pdf",
            "source": "research_report.pdf",
            "page": 1,
            "relevance_score": score,
        },
    )


def make_web_document():
    return Document(
        page_content="TCP is connection-oriented while UDP is connectionless.",
        metadata={
            "url": "https://example.com/tcp-udp",
        },
    )


# ============================================================
# ASK TUTOR — RAG
# ============================================================

def test_ask_tutor_rag_response(monkeypatch):

    rag_docs = [
        make_rag_document(0.80),
        make_rag_document(0.60),
    ]

    fake_result = {
        "student_answer": "Quantum computing uses qubits.",
        "context": rag_docs,
        "relevance": "full",
    }

    mock_graph = MagicMock()
    mock_graph.invoke.return_value = fake_result

    monkeypatch.setattr(
        backend,
        "tutor_graph",
        mock_graph,
    )

    result = backend.ask_tutor(
        question="What is quantum computing?",
        chat_history=[],
        document="research_report.pdf",
    )

    assert result["answer"] == "Quantum computing uses qubits."
    assert result["source_type"] == "RAG"
    assert result["source"] == "research_report.pdf"
    assert result["confidence"] == 0.70
    assert result["agent_status"] == "completed"

    assert result["trace"] == [
        "retrieve",
        "grade",
        "generate",
        "done",
    ]

    mock_graph.invoke.assert_called_once_with({
        "student_question": "What is quantum computing?",
        "document_id": "research_report.pdf",
    })


def test_ask_tutor_partial_stays_on_document(monkeypatch):

    fake_result = {
        "student_answer": "The paper compares several models.",
        "context": [make_rag_document(0.62)],
        "relevance": "partial",
    }

    mock_graph = MagicMock()
    mock_graph.invoke.return_value = fake_result
    monkeypatch.setattr(backend, "tutor_graph", mock_graph)

    result = backend.ask_tutor(
        question="What does the paper report?",
        chat_history=[],
        document="research_report.pdf",
    )

    assert result["source_type"] == "RAG"
    assert result["source"] == "research_report.pdf"
    assert "web_search" not in result["trace"]


# ============================================================
# ASK TUTOR — WEB FALLBACK
# ============================================================

def test_ask_tutor_web_fallback(monkeypatch):

    web_docs = [make_web_document()]

    fake_result = {
        "student_answer": "TCP is connection-oriented.",
        "context": web_docs,
        "relevance": "none",
    }

    mock_graph = MagicMock()
    mock_graph.invoke.return_value = fake_result

    monkeypatch.setattr(
        backend,
        "tutor_graph",
        mock_graph,
    )

    result = backend.ask_tutor(
        question="What is TCP?",
        chat_history=[],
    )

    assert result["answer"] == "TCP is connection-oriented."
    assert result["source_type"] == "WEB"
    assert result["source"] == "https://example.com/tcp-udp"
    assert result["confidence"] is None
    assert result["agent_status"] == "completed"

    assert result["trace"] == [
        "retrieve",
        "grade",
        "web_search",
        "generate",
        "done",
    ]


# ============================================================
# ASK TUTOR — NO CONTEXT
# ============================================================

def test_ask_tutor_no_context(monkeypatch):

    fake_result = {
        "student_answer": "I could not find enough information.",
        "context": [],
        "relevance": "none",
    }

    mock_graph = MagicMock()
    mock_graph.invoke.return_value = fake_result

    monkeypatch.setattr(
        backend,
        "tutor_graph",
        mock_graph,
    )

    result = backend.ask_tutor(
        question="Some question",
        chat_history=[],
    )

    assert result["source_type"] == "NONE"
    assert result["source"] is None
    assert result["confidence"] is None
    assert result["agent_status"] == "completed"


# ============================================================
# ASK TUTOR — UPLOADED FILE
# ============================================================

def test_ask_tutor_uses_uploaded_file_name(monkeypatch):

    fake_result = {
        "student_answer": "Answer from document.",
        "context": [make_rag_document()],
        "relevance": "full",
    }

    mock_graph = MagicMock()
    mock_graph.invoke.return_value = fake_result

    monkeypatch.setattr(
        backend,
        "tutor_graph",
        mock_graph,
    )

    uploaded_file = MagicMock()
    uploaded_file.name = "research_report.pdf"

    backend.ask_tutor(
        question="What is quantum computing?",
        chat_history=[],
        uploaded_file=uploaded_file,
    )

    mock_graph.invoke.assert_called_once_with({
        "student_question": "What is quantum computing?",
        "document_id": "research_report.pdf",
    })


# ============================================================
# ASK TUTOR — ERROR HANDLING
# ============================================================

def test_ask_tutor_handles_graph_error(monkeypatch):

    mock_graph = MagicMock()
    mock_graph.invoke.side_effect = RuntimeError("Graph failed")

    monkeypatch.setattr(
        backend,
        "tutor_graph",
        mock_graph,
    )

    result = backend.ask_tutor(
        question="What is quantum computing?",
        chat_history=[],
    )

    assert result["agent_status"] == "error"
    assert result["source_type"] == "NONE"
    assert result["source"] is None
    assert result["confidence"] is None
    assert result["trace"] == ["error"]
    assert "Graph failed" in result["answer"]


# ============================================================
# DOCUMENT INGESTION — NO FILE
# ============================================================

def test_ingest_document_without_file():

    result = backend.ingest_document(None)

    assert result["status"] == "error"
    assert result["chunks"] == 0
    assert result["name"] is None


# ============================================================
# DOCUMENT INGESTION — INVALID FILE
# ============================================================

def test_ingest_document_rejects_non_pdf():

    uploaded_file = MagicMock()
    uploaded_file.name = "notes.txt"

    result = backend.ingest_document(uploaded_file)

    assert result["status"] == "error"
    assert result["chunks"] == 0
    assert result["name"] == "notes.txt"
    assert result["message"] == "Only PDF files are supported."


# ============================================================
# DOCUMENT INGESTION — SUCCESS
# ============================================================

def test_ingest_document_success(monkeypatch):

    uploaded_file = MagicMock()
    uploaded_file.name = "research_report.pdf"
    uploaded_file.getvalue.return_value = b"fake pdf content"

    fake_pages = ["page1", "page2"]

    fake_chunks = [
        make_rag_document(),
        make_rag_document(),
        make_rag_document(),
    ]

    monkeypatch.setattr(
        backend,
        "parse_pdf_bytes",
        lambda content, source_name: fake_pages,
    )

    monkeypatch.setattr(
        backend,
        "chunk_pages",
        lambda pages, document_id, source_name: fake_chunks,
    )

    mock_add_chunks = MagicMock()

    monkeypatch.setattr(
        backend,
        "add_chunks",
        mock_add_chunks,
    )
    monkeypatch.setattr(backend, "extract_units_from_chunks", lambda chunks: [])
    monkeypatch.setattr(backend, "save_knowledge_units", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        backend,
        "save_pdf",
        lambda **kwargs: {"id": "x", "name": kwargs["name"]},
    )

    result = backend.ingest_document(uploaded_file)

    assert result["status"] == "ok"
    assert result["name"] == "research_report.pdf"
    assert result["chunks"] == 3
    assert result["message"] == "3 chunks indexed successfully."

    mock_add_chunks.assert_called_once_with(fake_chunks)


# ============================================================
# QUIZ
# ============================================================

def test_generate_quiz_returns_requested_count():

    result = backend.generate_quiz(
        topic="Computer Networks",
        difficulty="easy",
        count=3,
    )

    assert len(result) == 3

    for question in result:
        assert "q" in question
        assert "options" in question
        assert "answer" in question
        assert "why" in question


def test_generate_quiz_can_generate_more_than_bank_size():

    result = backend.generate_quiz(
        topic="Computer Networks",
        difficulty="medium",
        count=10,
    )

    assert len(result) == 10