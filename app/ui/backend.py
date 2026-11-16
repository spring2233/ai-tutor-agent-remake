"""
Integration boundary between the Streamlit UI and the LangGraph backend.

UI
 ↓
backend.py
 ↓
app.graph.tutor_graph
 ↓
Retrieve → Grade → Generate
             ↓
        Web Search (MCP)
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

import json

from app.rag.config import settings
from app.llm_factory import make_llm
from app.graph import tutor_graph, llm, extract_text
from app.prompts.prompt_manager import PromptManager
from app.rag.chunker import chunk_pages
from app.rag.library import (
    get_document,
    new_document_id,
    remove_stored_document,
    save_pdf,
)
from app.rag.pdf_parser import parse_pdf, parse_pdf_bytes
from app.rag.retriever import retrieve
from app.rag.vector_store import (
    add_chunks,
    delete_document,
    get_all_chunks_for_document,
)
from app.metrics import start_timer, elapsed_ms
from app.rag.spaced_repetition import calculate_sm2
from app.study_plan.planner import (
    generate_study_plan,
    start_session,
    complete_session,
    get_next_pending_session,
    get_study_plan_progress,
)


# ============================================================
# DOCUMENT INGESTION
# ============================================================

def ingest_document(uploaded_file: Any) -> Dict[str, Any]:
    """
    Save a Streamlit UploadedFile temporarily, parse it,
    chunk it and store the chunks in ChromaDB.
    """

    if uploaded_file is None:
        return {
            "status": "error",
            "chunks": 0,
            "name": None,
            "message": "No file provided.",
        }

    try:
        file_name = uploaded_file.name

        if not file_name.lower().endswith(".pdf"):
            return {
                "status": "error",
                "chunks": 0,
                "name": file_name,
                "message": "Only PDF files are supported.",
            }

        content = uploaded_file.getvalue()
        # Parse in memory. Writing a Windows temp PDF then reopening it
        # often fails with OSError [Errno 22] Invalid argument.
        pages = parse_pdf_bytes(content, source_name=file_name)
        document_id = new_document_id()

        chunks = chunk_pages(
            pages=pages,
            document_id=document_id,
            source_name=file_name,
        )

        add_chunks(chunks)
        try:
            save_pdf(
                document_id=document_id,
                content=content,
                name=file_name,
                pages=len(pages),
                chunks=len(chunks),
            )
        except Exception:
            try:
                delete_document(document_id)
            except Exception:
                pass
            raise

        return {
            "status": "ok",
            "chunks": len(chunks),
            "name": file_name,
            "document_id": document_id,
            "pages": len(pages),
            "message": f"{len(chunks)} chunks indexed successfully.",
        }

    except Exception as exc:
        message = str(exc)
        if isinstance(exc, OSError) and getattr(exc, "errno", None) == 22:
            message = (
                "Windows 无法打开这份 PDF 的临时文件（Errno 22）。"
                "请换一份 PDF 再试。"
            )
        return {
            "status": "error",
            "chunks": 0,
            "name": getattr(uploaded_file, "name", None),
            "message": message,
        }


# ============================================================
# ASK TUTOR
# ============================================================

def ask_tutor(
    question: str,
    chat_history: List[Dict[str, Any]],
    document: Optional[str] = None,
    uploaded_file: Any = None,
) -> Dict[str, Any]:
    """
    Send a question from the Streamlit UI to the LangGraph tutor agent.
    """

    try:
        # ---------------------------------------------------------
        # Determine document ID
        # ---------------------------------------------------------
        document_id = None

        if uploaded_file is not None:
            document_id = getattr(uploaded_file, "name", None)

        if not document_id and document:
            document_id = document

        # ---------------------------------------------------------
        # Build graph state
        # ---------------------------------------------------------
        state = {
            "student_question": question,
        }

        if document_id:
            state["document_id"] = document_id

        # ---------------------------------------------------------
        # Run LangGraph (timed)
        # ---------------------------------------------------------
        timer = start_timer()

        result = tutor_graph.invoke(state)

        total_ms = elapsed_ms(timer)

        # ---------------------------------------------------------
        # Extract response
        # ---------------------------------------------------------
        answer = result.get(
            "student_answer",
            "No answer was generated.",
        )

        context = result.get("context", [])
        relevance = result.get("relevance", "none")

        # ---------------------------------------------------------
        # Determine source type
        # ---------------------------------------------------------
        if relevance == "full":
            source_type = "RAG"
        elif context:
            source_type = "WEB"
        else:
            source_type = "NONE"

        # ---------------------------------------------------------
        # Extract source
        # ---------------------------------------------------------
        source = None

        if context:
            first_doc = context[0]

            if hasattr(first_doc, "metadata"):
                metadata = first_doc.metadata

                # RAG document source
                source = metadata.get("source")

                # Web-search source
                if source is None:
                    source = metadata.get("url")

        if source is None and source_type == "RAG":
            source = document_id

        # ---------------------------------------------------------
        # Calculate confidence (average across retrieved chunks,
        # not just the single best-scoring chunk)
        # ---------------------------------------------------------
        confidence = None

        if source_type == "RAG" and context:
            scores = []

            for doc in context:
                if hasattr(doc, "metadata"):
                    score = doc.metadata.get("relevance_score")

                    if score is not None:
                        scores.append(float(score))

            if scores:
                confidence = round(sum(scores) / len(scores), 2)

        # ---------------------------------------------------------
        # Execution trace
        # ---------------------------------------------------------
        trace = [
            "retrieve",
            "grade",
        ]

        if source_type == "WEB":
            trace.append("web_search")

        trace.extend([
            "generate",
            "done",
        ])

        return {
            "answer": answer,
            "source": source,
            "confidence": confidence,
            "source_type": source_type,
            "trace": trace,
            "agent_status": "completed",
            "metrics": {
                **result.get("metrics", {}),
                "total_ms": total_ms,
            },
        }

    except Exception as exc:
        return {
            "answer": (
                "⚠️ The tutor backend encountered an error.\n\n"
                f"`{exc}`"
            ),
            "source": None,
            "confidence": None,
            "source_type": "NONE",
            "trace": ["error"],
            "agent_status": "error",
            "metrics": {},
        }


# ============================================================
# QUIZ & FLASHCARDS HELPER
# ============================================================
def _extract_json_from_response(response_text: str) -> str:
    """Extracts JSON from an LLM response, handling <think> tags and markdown blocks."""
    # 1. Try to extract from markdown code blocks
    json_match = re.search(r'```(?:json)?\n(.*?)\n```', response_text, re.DOTALL | re.IGNORECASE)
    if json_match:
        response_text = json_match.group(1)
    else:
        # 2. Try to strip <think>...</think> tags
        response_text = re.sub(r'<think>.*?</think>', '', response_text, flags=re.DOTALL)
        
        # 3. If there is still an unclosed <think> tag, try to split
        if "<think>" in response_text:
            parts = response_text.split("<think>")
            if len(parts) > 1 and "]" in parts[1]: # Try to find where the JSON starts (usually [ )
                # Not a perfect heuristic, but if it fails we fall back.
                # Actually, if there's an unclosed <think>, just find the first '[' or '{'
                idx = response_text.find("[")
                if idx == -1: idx = response_text.find("{")
                if idx != -1:
                    response_text = response_text[idx:]
        
    # 4. Fallback cleanup
    response_text = response_text.strip()
    if response_text.startswith("```json"):
        response_text = response_text[7:]
    elif response_text.startswith("```"):
        response_text = response_text[3:]
        
    if response_text.endswith("```"):
        response_text = response_text[:-3]
        
    return response_text.strip()

# ============================================================
# QUIZ
# ============================================================

def generate_quiz(
    topic: str,
    difficulty: str,
    count: int,
) -> List[Dict[str, Any]]:

    prompt_template = PromptManager.get_quiz_prompt()
    formatted_prompt = prompt_template.format(
        topic=topic,
        difficulty=difficulty,
        count=count
    )

    try:
        quiz_llm = make_llm(temperature=0)

        response = quiz_llm.invoke(formatted_prompt)
        response_text = extract_text(response).strip()
        
        response_text = _extract_json_from_response(response_text)
        
        quiz_data = json.loads(response_text)
        
        if isinstance(quiz_data, list):
            return quiz_data
        else:
            return []
    except Exception as e:
        print(f"Error generating quiz: {e}")
        return []


def get_flashcards(
    topic: str,
    count: int = 5,
) -> List[Dict[str, Any]]:
    """Generate flashcards using the project's existing LLM."""

    prompt_template = PromptManager.get_flashcard_prompt()

    formatted_prompt = prompt_template.format(
        topic=topic,
        count=count,
    )

    try:
        response = llm.invoke(formatted_prompt)
        response_text = extract_text(response).strip()

        response_text = _extract_json_from_response(response_text)

        cards = json.loads(response_text)

        if not isinstance(cards, list):
            return []

        return cards[:count]

    except Exception as exc:
        print(f"Error generating flashcards: {exc}")
        return []


def forget_document(document_id: str) -> bool:
    """Remove a stored PDF and its indexed chunks."""
    removed = remove_stored_document(document_id)
    if not removed:
        return False
    try:
        delete_document(document_id)
    except Exception:
        pass
    return True


_MEMORY_CONTEXT_CHARS = 8000


def _sample_document_context(chunks: List[str], limit: int = _MEMORY_CONTEXT_CHARS) -> str:
    texts = [chunk.strip() for chunk in chunks if chunk and chunk.strip()]
    if not texts:
        return ""

    if sum(len(text) for text in texts) <= limit:
        return "\n\n".join(texts)

    picked: List[str] = []
    used = 0
    step = max(1, len(texts) // 12)
    for index in range(0, len(texts), step):
        piece = texts[index]
        if used + len(piece) > limit:
            remaining = limit - used
            if remaining > 200:
                picked.append(piece[:remaining])
            break
        picked.append(piece)
        used += len(piece) + 2
    return "\n\n".join(picked)


def _normalize_memory_pairs(raw: Any, pair_count: int) -> Optional[List[Dict[str, str]]]:
    if not isinstance(raw, list):
        return None

    seen = set()
    pairs: List[Dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        term = str(item.get("term", "")).strip()
        definition = str(item.get("definition", "")).strip()
        key = term.casefold()
        if (
            not term
            or not definition
            or key in seen
            or term.casefold() == definition.casefold()
        ):
            continue
        seen.add(key)
        pairs.append({"term": term, "definition": definition})
        if len(pairs) == pair_count:
            return pairs
    return None


def generate_memory_pairs(
    document_id: str,
    pair_count: int = 6,
) -> List[Dict[str, str]]:
    """Build term/definition pairs from one indexed PDF."""
    pair_count = max(1, min(8, int(pair_count)))
    record = get_document(document_id)
    if record is None:
        raise ValueError("Document not found.")

    context = _sample_document_context(
        get_all_chunks_for_document(document_id)
    )
    if not context:
        raise ValueError("This document has no indexed text.")

    prompt_template = PromptManager.get_memory_prompt()
    safe_name = str(record.get("name") or document_id).replace("{", "").replace("}", "")
    safe_context = context.replace("{", "(").replace("}", ")")
    formatted_prompt = prompt_template.format(
        name=safe_name,
        count=pair_count,
        context=safe_context,
    )

    last_error = "Could not build memory pairs from this document."
    for _ in range(2):
        try:
            response = llm.invoke(formatted_prompt)
            response_text = _extract_json_from_response(
                extract_text(response).strip()
            )
            pairs = _normalize_memory_pairs(
                json.loads(response_text),
                pair_count,
            )
            if pairs:
                return pairs
        except Exception as exc:
            last_error = str(exc)

    raise ValueError(last_error)


_GENRES = {
    "research": "research",
    "科研": "research",
    "teaching": "teaching",
    "教学": "teaching",
    "exam": "exam",
    "试题": "exam",
    "quiz": "exam",
}


def _normalize_quest_question(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    question = str(item.get("q", "")).strip()
    why = str(item.get("why", "")).strip()
    answer = str(item.get("answer", "")).strip()
    raw_options = item.get("options")
    if not question or not answer or not isinstance(raw_options, list):
        return None
    options = []
    for option in raw_options:
        text = str(option).strip()
        if text and text not in options:
            options.append(text)
    if len(options) < 4 or answer not in options:
        return None
    return {
        "q": question,
        "options": options[:4],
        "answer": answer,
        "why": why or "Review this idea in the document.",
    }


def _normalize_quest(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    genre = _GENRES.get(str(raw.get("genre", "")).strip().lower())
    if genre is None:
        genre = _GENRES.get(str(raw.get("genre", "")).strip())
    if genre is None:
        return None

    areas = []
    for area in raw.get("areas") or []:
        if not isinstance(area, dict):
            continue
        title = str(area.get("title", "")).strip()
        summary = str(area.get("summary", "")).strip()
        tasks = []
        for task in area.get("tasks") or []:
            if not isinstance(task, dict):
                continue
            concept = str(task.get("concept", "")).strip()
            question = _normalize_quest_question(task)
            if not concept or question is None:
                continue
            tasks.append({
                "concept": concept,
                **question,
            })
            if len(tasks) == 2:
                break
        if title and len(tasks) == 2:
            area_id = f"area-{len(areas) + 1}"
            for task_index, task in enumerate(tasks):
                task["id"] = f"{area_id}-task-{task_index + 1}"
            areas.append({
                "id": area_id,
                "title": title,
                "summary": summary,
                "tasks": tasks,
            })
        if len(areas) == 5:
            break
    if len(areas) < 3:
        return None

    boss = []
    for item in raw.get("boss") or []:
        question = _normalize_quest_question(item)
        if question is None:
            continue
        boss.append(question)
        if len(boss) == 5:
            break
    if len(boss) < 5:
        return None

    return {
        "title": str(raw.get("title", "")).strip() or "Learning Quest",
        "genre": genre,
        "areas": areas,
        "boss": boss,
    }


def generate_quest(document_id: str) -> Dict[str, Any]:
    """Build a chapter quest line and a boss check from one PDF."""
    record = get_document(document_id)
    if record is None:
        raise ValueError("Document not found.")

    context = _sample_document_context(get_all_chunks_for_document(document_id))
    if not context:
        raise ValueError("This document has no indexed text.")

    safe_name = str(record.get("name") or document_id).replace("{", "").replace("}", "")
    safe_context = context.replace("{", "(").replace("}", ")")
    formatted_prompt = PromptManager.get_quest_prompt().format(
        name=safe_name,
        context=safe_context,
    )

    last_error = "Could not build a quest from this document."
    for _ in range(2):
        try:
            response = llm.invoke(formatted_prompt)
            response_text = _extract_json_from_response(extract_text(response).strip())
            quest = _normalize_quest(json.loads(response_text))
            if quest:
                return quest
        except Exception as exc:
            last_error = str(exc)

    raise ValueError(last_error)


def submit_flashcard_answer(
    quality: int,
    previous_interval: int = 0,
    previous_repetitions: int = 0,
    previous_ease_factor: float = 2.5,
) -> Dict[str, Any]:
    """Calculate the next flashcard review interval using SM-2."""

    try:
        interval, repetitions, ease_factor = calculate_sm2(
            quality=quality,
            interval=previous_interval,
            repetitions=previous_repetitions,
            ease_factor=previous_ease_factor,
        )

        return {
            "status": "success",
            "next_interval_days": interval,
            "repetitions": repetitions,
            "ease_factor": round(ease_factor, 2),
        }

    except Exception as exc:
        return {
            "status": "error",
            "error": str(exc),
        }

# ============================================================
# PERSONALIZED STUDY PLAN
# ============================================================

def create_study_plan(
    goal: str,
    current_level: str,
    topics: list[str],
    daily_hours: float,
    duration_days: int,
    plan_type: str = "learning",
    exam_date: str | None = None,
) -> Dict[str, Any]:
    """
    Generate a personalized flexible study plan.
    """

    try:
        return generate_study_plan(
            goal=goal,
            current_level=current_level,
            topics=topics,
            daily_hours=daily_hours,
            duration_days=duration_days,
            plan_type=plan_type,
            exam_date=exam_date,
        )

    except Exception as exc:
        return {
            "error": str(exc),
        }

def begin_study_session(
    plan: Dict[str, Any],
    session_number: int,
) -> Dict[str, Any]:
    """
    Mark a study session as in progress.
    """
    return start_session(plan, session_number)


def finish_study_session(
    plan: Dict[str, Any],
    session_number: int,
) -> Dict[str, Any]:
    """
    Mark a study session as completed.
    """
    return complete_session(plan, session_number)


def get_study_plan_status(
    plan: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Return the current study-plan progress.
    """
    return get_study_plan_progress(plan)

# ============================================================
# MIND MAP
# ============================================================

def generate_mindmap(topic: str, document_id: Optional[str] = None) -> str:
    """
    Generate a mind map in Mermaid.js syntax using the LLM.
    If a document_id is provided, retrieves context via RAG.
    """
    context_text = ""
    if document_id:
        try:
            documents = retrieve(question=topic, document_id=document_id)
            if documents:
                context_text = "\n\n".join(doc.page_content for doc in documents)
        except Exception as e:
            print(f"Error retrieving context for mind map: {e}")

    prompt_template = PromptManager.get_mindmap_prompt()
    formatted_prompt = prompt_template.format(
        topic=topic,
        context=context_text
    )

    try:
        response = llm.invoke(formatted_prompt)
        response_text = extract_text(response).strip()
        
        # 1. Try to extract from markdown code blocks
        mermaid_match = re.search(r'```(?:mermaid)?\n(.*?)\n```', response_text, re.DOTALL | re.IGNORECASE)
        if mermaid_match:
            response_text = mermaid_match.group(1)
        else:
            # 2. Try to strip <think>...</think> tags
            response_text = re.sub(r'<think>.*?</think>', '', response_text, flags=re.DOTALL)
            
            # 3. If there is still a <think> tag (e.g. unclosed), just find 'flowchart'
            idx = response_text.find("flowchart")
            if idx != -1:
                response_text = response_text[idx:]
            
        # 4. Fallback cleanup
        response_text = response_text.strip()
        if response_text.startswith("```mermaid"):
            response_text = response_text[10:]
        elif response_text.startswith("```"):
            response_text = response_text[3:]
            
        if response_text.endswith("```"):
            response_text = response_text[:-3]
            
        return response_text.strip()
    except Exception as e:
        print(f"Error generating mind map: {e}")
        return ""
