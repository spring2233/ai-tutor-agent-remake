from unittest.mock import MagicMock

from langchain_core.documents import Document

from app.ui import backend
from app.graph import grade_node, route_after_grading


# ============================================================
# GRAPH EDGE CASES
# ============================================================

def test_grade_node_with_empty_context():

    result = grade_node({
        "student_question": "What is quantum computing?",
        "context": [],
    })

    assert result["relevance"] == "none"


def test_route_invalid_relevance_goes_to_web_search():

    result = route_after_grading({
        "relevance": "invalid",
    })

    assert result == "web_search"


def test_route_missing_relevance_goes_to_web_search():

    result = route_after_grading({})

    assert result == "web_search"


# ============================================================
# BACKEND EDGE CASES
# ============================================================

def test_ask_tutor_with_empty_question(monkeypatch):

    mock_graph = MagicMock()

    mock_graph.invoke.return_value = {
        "student_answer": "Please provide a question.",
        "context": [],
        "relevance": "none",
    }

    monkeypatch.setattr(
        backend,
        "tutor_graph",
        mock_graph,
    )

    result = backend.ask_tutor(
        question="",
        chat_history=[],
    )

    assert result["agent_status"] == "completed"
    assert result["source_type"] == "NONE"

    mock_graph.invoke.assert_called_once_with({
        "student_question": "",
    })


def test_ask_tutor_handles_missing_answer(monkeypatch):

    mock_graph = MagicMock()

    mock_graph.invoke.return_value = {
        "context": [],
        "relevance": "none",
    }

    monkeypatch.setattr(
        backend,
        "tutor_graph",
        mock_graph,
    )

    result = backend.ask_tutor(
        question="What is quantum computing?",
        chat_history=[],
    )

    assert result["answer"] == "No answer was generated."
    assert result["agent_status"] == "completed"


def test_ask_tutor_handles_rag_without_scores(monkeypatch):

    document = Document(
        page_content="Quantum computing uses qubits.",
        metadata={
            "source": "research_report.pdf",
        },
    )

    mock_graph = MagicMock()

    mock_graph.invoke.return_value = {
        "student_answer": "Quantum computing uses qubits.",
        "context": [document],
        "relevance": "full",
    }

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

    assert result["source_type"] == "RAG"
    assert result["source"] == "research_report.pdf"
    assert result["confidence"] is None
    assert result["agent_status"] == "completed"


# ============================================================
# DOCUMENT INGESTION EDGE CASE
# ============================================================

def test_ingest_document_handles_parser_failure(monkeypatch):

    uploaded_file = MagicMock()
    uploaded_file.name = "broken.pdf"
    uploaded_file.getvalue.return_value = b"invalid pdf data"

    def failing_parser(content, source_name):
        raise RuntimeError("PDF parsing failed")

    monkeypatch.setattr(
        backend,
        "parse_pdf_bytes",
        failing_parser,
    )

    result = backend.ingest_document(uploaded_file)

    assert result["status"] == "error"
    assert result["chunks"] == 0
    assert result["name"] == "broken.pdf"
    assert "PDF parsing failed" in result["message"]