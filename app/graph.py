import json
import logging
import re
from typing import TypedDict, List

from langchain_core.documents import Document
from langgraph.graph import StateGraph, END

from app.rag.retriever import retrieve
from app.rag.document_context import (
    expand_document_context,
    has_document_wide,
    is_overview_question,
)
from app.prompts.prompt_manager import PromptManager
from app.rag.config import settings
from app.llm_factory import make_llm
from mcp_server.web_search_node import web_search_node
from app.metrics import start_timer, elapsed_ms, create_metrics, add_token_usage

# ============================================================
# LOGGING
# ============================================================

logger = logging.getLogger(__name__)
if not logger.handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(name)s | %(levelname)s | %(message)s"
    )


# ============================================================
# STATE
# ============================================================

class TutorState(TypedDict, total=False):
    student_question: str
    document_id: str

    # Retrieved study material
    context: List[Document]

    # Grader result: "full" | "partial" | "none"
    relevance: str

    # Final answer
    student_answer: str

    # Per-node timing (ms)
    metrics: dict


# ============================================================
# LLM
# ============================================================

llm = make_llm(settings.llm_temperature)


# ============================================================
# HELPER: EXTRACT TEXT FROM LLM RESPONSE
# ============================================================

def extract_text(response):
    """
    Handles different response formats returned by the LLM.
    """

    content = response.content

    # Normal LangChain response
    if isinstance(content, str):
        return content

    # Some models may return blocks
    if isinstance(content, list):
        text_parts = []

        for block in content:
            if isinstance(block, dict):
                text_parts.append(block.get("text", ""))

        return "".join(text_parts)

    return str(content)


# ============================================================
# NODE 1: RETRIEVE
# ============================================================

def retrieve_node(state: TutorState) -> dict:

    logger.info("--- RETRIEVING CONTEXT ---")

    timer = start_timer()

    question = state.get("student_question", "")
    document_id = state.get("document_id", "")

    if not question:
        logger.warning("No student question found.")

    # No PDF uploaded — skip RAG entirely and let the graph
    # fall through to the MCP web_search node instead of
    # letting retrieve() raise a ValueError.
    if not document_id:
        logger.info("No document_id provided. Skipping RAG retrieval.")
        return {
            "context": [],
            "retrieved": [],
            "metrics": {
                **state.get("metrics", create_metrics()),
                "retrieve_ms": elapsed_ms(timer),
            },
        }

    documents = retrieve(
        question=question,
        document_id=document_id
    )

    # Make sure context is always a list
    if documents is None:
        documents = []

    logger.info("Retrieved documents: %d", len(documents))
    # Similarity hits stay in `retrieved` for grading a specific question.
    # `context` adds the knowledge map and, for whole-document questions,
    # source text in reading order.
    documents = list(documents)
    context = expand_document_context(question, document_id, documents)

    # Log retrieved context for debugging
    for i, document in enumerate(documents, start=1):
        logger.debug(
            "Document %d | Source: %s | Page: %s | Score: %s",
            i,
            document.metadata.get("source", "N/A"),
            document.metadata.get("page", "N/A"),
            document.metadata.get("relevance_score", "N/A")
        )
        logger.debug("Text: %s...", document.page_content[:300])

    return {
        "context": context,
        "retrieved": documents,
        "metrics": {
            **state.get("metrics", create_metrics()),
            "retrieve_ms": elapsed_ms(timer),
        },
    }


# ============================================================
# NODE 2: GRADE RETRIEVED CONTEXT
# ============================================================

def grade_node(state: TutorState) -> dict:

    logger.info("--- GRADING RETRIEVED CONTEXT ---")

    timer = start_timer()

    question = state.get("student_question", "")
    context = state.get("context", [])

    # A question about the whole PDF is covered once the map or the
    # ordered source text is present. Grading those long contexts would
    # only repeat the same conclusion and can miss sections.
    if is_overview_question(question) and has_document_wide(context):
        logger.info("Overview question has document-wide context. Relevance: full")
        return {
            "relevance": "full",
            "metrics": {
                **state.get("metrics", create_metrics()),
                "grade_ms": elapsed_ms(timer),
            },
        }

    grade_docs = _documents_to_grade(state, context)

    # No retrieved context
    if not grade_docs:
        logger.info("No context retrieved. Relevance: none")
        return {
            "relevance": "none",
            "metrics": {
                **state.get("metrics", create_metrics()),
                "grade_ms": elapsed_ms(timer),
            },
        }

    # Convert documents into plain text
    context_text = "\n\n".join(
        document.page_content
        for document in grade_docs
    )

    # Get grader prompt
    grader_prompt_template = PromptManager.get_grader_prompt()

    formatted_prompt = grader_prompt_template.format(
        context=context_text,
        question=question
    )

    # Ask LLM to grade retrieved context
    response = llm.invoke(formatted_prompt)
    response_text = extract_text(response).strip()

    logger.debug("[GRADER OUTPUT]: %s", response_text)

    # Parse grader JSON. Gemini often wraps the object in ```json fences.
    try:
        relevance = parse_relevance(response_text)

    except (json.JSONDecodeError, AttributeError, TypeError):
        logger.warning(
            "Could not parse grader response: %s",
            response_text
        )
        relevance = "none"

    # Validate grader output
    if relevance not in {"full", "partial", "none"}:
        logger.warning(
            "Invalid relevance value '%s'. Treating as none.",
            relevance
        )
        relevance = "none"

    logger.info("Relevance: %s", relevance)

    metrics = add_token_usage(state.get("metrics", create_metrics()), response)
    metrics["grade_ms"] = elapsed_ms(timer)

    return {
        "relevance": relevance,
        "metrics": metrics,
    }


# ============================================================
# NODE 3: GENERATE ANSWER
# ============================================================

def generate_node(state: TutorState) -> dict:

    logger.info("--- GENERATING ANSWER ---")

    timer = start_timer()

    question = state.get("student_question", "")
    context = state.get("context", [])

    # Convert retrieved documents to text
    context_text = "\n\n".join(
        document.page_content
        for document in context
    )

    logger.info("Context length provided to LLM: %d chars", len(context_text))
    if context_text:
        logger.debug("Context snippet: %s...", context_text[:100])

    # Get actual generator prompt
    generator_prompt_template = (
        PromptManager.get_generator_prompt()
    )

    formatted_prompt = generator_prompt_template.format(
        context=context_text,
        question=question
    )

    # Generate answer using LLM
    response = llm.invoke(formatted_prompt)
    answer = extract_text(response)
    metrics = add_token_usage(state.get("metrics", create_metrics()), response)
    metrics["generate_ms"] = elapsed_ms(timer)

    return {
        "student_answer": answer,
        "metrics": metrics,
    }


# ============================================================
# NODE 4: WEB SEARCH (MCP)
# ============================================================
# The actual implementation lives in mcp_server/web_search_node.py.
# It connects to the local FastMCP server (port 8000), performs a
# DuckDuckGo search, and appends the results to state["context"]
# so the generate node can use them to answer the student.
#
# NOTE: Timing for this node is intentionally NOT added yet —
# we're keeping web_search_node.py untouched until basic metrics
# are verified end-to-end.


# ============================================================
# CONDITIONAL ROUTING
# ============================================================

def _documents_to_grade(state: TutorState, context: list) -> list:
    """Grade specific questions on similarity hits, not the whole-document map."""

    if "retrieved" in state and state.get("retrieved"):
        return list(state["retrieved"])
    if "retrieved" in state:
        return [
            document
            for document in context
            if (getattr(document, "metadata", None) or {}).get("role") == "knowledge_map"
        ]
    return list(context)


def parse_relevance(response_text: str) -> str:
    """Read the grader's relevance label, including fenced JSON."""

    text = response_text.strip()
    fenced = re.search(
        r"```(?:json)?\s*(.*?)\s*```",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )
    if fenced:
        text = fenced.group(1).strip()
    else:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end > start:
            text = text[start:end + 1]

    result = json.loads(text)
    return str(result.get("relevance", "none")).lower()


def route_after_grading(state: TutorState) -> str:

    relevance = state.get("relevance", "none")

    # The uploaded document can answer fully or partly: stay with it.
    # Search only when the document does not cover the question.
    if relevance in {"full", "partial"}:
        return "generate"

    return "web_search"


# ============================================================
# BUILD LANGGRAPH
# ============================================================

workflow = StateGraph(TutorState)


# Add nodes
workflow.add_node(
    "retrieve",
    retrieve_node
)

workflow.add_node(
    "grade",
    grade_node
)

workflow.add_node(
    "generate",
    generate_node
)

workflow.add_node(
    "web_search",
    web_search_node
)


# ============================================================
# DEFINE FLOW
# ============================================================

# Start
workflow.set_entry_point("retrieve")


# Retrieve → Grade
workflow.add_edge(
    "retrieve",
    "grade"
)


# Grade → Generate OR Fallback
workflow.add_conditional_edges(
    "grade",
    route_after_grading,
    {
        "generate": "generate",
        "web_search": "web_search"
    }
)


# Generate → End
workflow.add_edge(
    "generate",
    END
)


# Web Search → Generate (so the LLM answers using web results)
workflow.add_edge(
    "web_search",
    "generate"
)


# ============================================================
# COMPILE GRAPH
# ============================================================

tutor_graph = workflow.compile()


# ============================================================
# LOCAL TEST
# ============================================================

if __name__ == "__main__":

    logger.info("INITIATING AI TUTOR PIPELINE")

    initial_state = {
        "student_question": "What is quantum computing and what is its time complexity?",
        "document_id": "research_report.pdf",
    }

    final_state = tutor_graph.invoke(initial_state)

    print("\n" + "=" * 46)
    print("           FINAL TUTOR ANSWER")
    print("=" * 46)

    print(
        final_state.get(
            "student_answer",
            "No answer generated."
        )
    )

    print("\nMetrics:", final_state.get("metrics"))

    print("\n==============================================")