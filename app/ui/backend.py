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
from typing import Any, Dict, List, Optional, Tuple

import json

from app.rag.config import settings
from app.llm_factory import make_llm
from app.graph import tutor_graph, llm, extract_text
from app.prompts.prompt_manager import PromptManager
from app.prompts.zone_prompt import MAX_PLAY_ZONES, MIN_PLAY_ZONES
from app.rag.chunker import chunk_pages
from app.rag.knowledge_map import (
    extract_units_from_chunks,
    format_units_context,
)
from app.rag.library import (
    get_document,
    load_knowledge_units,
    new_document_id,
    remove_stored_document,
    save_knowledge_units,
    save_pdf,
    update_document_meta,
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
        units: List[Dict[str, Any]] = []
        try:
            save_pdf(
                document_id=document_id,
                content=content,
                name=file_name,
                pages=len(pages),
                chunks=len(chunks),
            )
            try:
                units = extract_units_from_chunks(chunks)
                save_knowledge_units(document_id, units)
            except Exception:
                units = []
            try:
                sample_text = " ".join(
                    str(getattr(c, "page_content", c))[:400] for c in chunks[:3]
                )
                unit_names = " ".join(str(u.get("name", "")) for u in units[:6] if isinstance(u, dict))
                inferred = _infer_planet_meta(file_name, f"{unit_names} {sample_text}")
                update_document_meta(document_id, inferred)
            except Exception:
                inferred = {}
        except Exception:
            try:
                delete_document(document_id)
            except Exception:
                pass
            raise

        unit_note = f" Extracted {len(units)} knowledge units." if units else ""
        return {
            "status": "ok",
            "chunks": len(chunks),
            "name": file_name,
            "document_id": document_id,
            "pages": len(pages),
            "units": len(units),
            "planetName": inferred.get("planetName"),
            "themeCategory": inferred.get("themeCategory"),
            "themeSummary": inferred.get("themeSummary"),
            "message": f"{len(chunks)} chunks indexed successfully.{unit_note}",
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
        # full and partial both stayed on the uploaded document.
        # Web search runs only when relevance is none.
        if relevance in {"full", "partial"}:
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

        if source_type == "RAG":
            scored = context
            if not any(
                hasattr(doc, "metadata") and doc.metadata.get("relevance_score") is not None
                for doc in context
            ):
                scored = result.get("retrieved") or []

            scores = []
            for doc in scored:
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


_DEFAULT_GUARDIAN = "GUARDIAN // 熵增逻辑体"
_SIGNAL_WORDS = {"true", "signal", "yes", "1", "信号", "正确", "成立"}
_NOISE_WORDS = {"false", "noise", "no", "0", "噪声", "错误", "不成立"}


def _normalize_calibration(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    statement = str(item.get("statement", "")).strip()
    raw_flag = item.get("isSignal")
    if isinstance(raw_flag, bool):
        is_signal = raw_flag
    else:
        flag = str(raw_flag).strip().lower()
        if flag in _SIGNAL_WORDS:
            is_signal = True
        elif flag in _NOISE_WORDS:
            is_signal = False
        else:
            return None
    if not statement:
        return None
    return {
        "statement": statement,
        "isSignal": is_signal,
        "why": str(item.get("why", "")).strip() or "Review this idea in the document.",
    }


def _normalize_feynman_boss(item: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    challenge = str(item.get("challengePrompt", "")).strip()
    points = []
    for point in item.get("keyPoints") or []:
        text = str(point).strip()
        if text and text not in points:
            points.append(text)
    if not challenge or len(points) < 2:
        return None
    reference = str(item.get("referenceExplanation", "")).strip()
    decoy = str(item.get("decoyTerm", "")).strip()
    terms = [term for term in _unique_texts(item.get("terms")) if term != decoy][:3]
    return {
        "guardianName": str(item.get("guardianName", "")).strip() or _DEFAULT_GUARDIAN,
        "challengePrompt": challenge,
        "keyPoints": points[:4],
        "followUpHint": str(item.get("followUpHint", "")).strip(),
        "referenceExplanation": reference or "；".join(points[:4]),
        "terms": terms,
        "decoyTerm": decoy,
    }


def _unique_texts(values: Any) -> List[str]:
    if not isinstance(values, list):
        return []
    texts: List[str] = []
    for value in values:
        text = str(value).strip()
        if text and text not in texts:
            texts.append(text)
    return texts


_GATE_MIN_CHARS = 4
_GATE_MAX_CHARS = 22
_GATE_MAX_LENGTH_GAP = 5
_GATE_MAX_PER_ZONE = 4
_GATE_NOTE_MAX_CHARS = 60


def _gate_length(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


def _normalize_gates(items: Any, boss: Dict[str, Any]) -> List[Dict[str, str]]:
    """Twin gates: drop pairs that are too long or visibly lopsided, so the trap never reads as an obvious fake."""
    if not isinstance(items, list):
        return []
    gates: List[Dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        truth = str(item.get("truth", "")).strip().rstrip("。.")
        trap = str(item.get("trap", "")).strip().rstrip("。.")
        if not truth or not trap or truth == trap:
            continue
        lengths = (_gate_length(truth), _gate_length(trap))
        if min(lengths) < _GATE_MIN_CHARS or max(lengths) > _GATE_MAX_CHARS:
            continue
        if abs(lengths[0] - lengths[1]) > _GATE_MAX_LENGTH_GAP:
            continue
        probe = str(item.get("probe", "")).strip() or boss["followUpHint"]
        if not probe:
            continue
        gate = {"truth": truth, "trap": trap, "probe": probe}
        note = str(item.get("note", "")).strip()
        if note:
            gate["note"] = note[:_GATE_NOTE_MAX_CHARS]
        gates.append(gate)
        if len(gates) == _GATE_MAX_PER_ZONE:
            break
    return gates


def _normalize_intel(item: Any, boss: Dict[str, Any], summary: str) -> Dict[str, Any]:
    """30-second briefing; falls back to the guardian's key points when the model skips it."""
    data = item if isinstance(item, dict) else {}
    conclusions = _unique_texts(data.get("conclusions"))[:3]
    if len(conclusions) < 3:
        extra = [summary] + boss["keyPoints"] if summary else boss["keyPoints"]
        conclusions += [text for text in extra if text not in conclusions][: 3 - len(conclusions)]
    return {
        "conclusions": conclusions,
        "analogy": str(data.get("analogy", "")).strip(),
    }


_THEME_CATEGORIES = {"ai_cs", "physics_math", "bio_med", "humanities"}


def _infer_planet_meta(file_name: str, context_hint: str = "", raw: Any = None) -> Dict[str, str]:
    blob = f"{file_name} {context_hint}".lower()
    raw_dict = raw if isinstance(raw, dict) else {}

    cat = str(raw_dict.get("themeCategory", "")).strip()
    if cat not in _THEME_CATEGORIES:
        if any(k in blob for k in ("transformer", "attention", "neural", "deep", "llm", "gpt", "rag", "agent", "algorithm", "robot", "sim", "control", "计算机", "人工智能", "神经网络", "深度学习", "算法", "模型", "控制")):
            cat = "ai_cs"
        elif any(k in blob for k in ("thermodynamic", "entropy", "quantum", "physics", "calculus", "matrix", "linear", "theorem", "relativity", "热力学", "熵", "量子", "物理", "数学", "矩阵", "方程", "力学")):
            cat = "physics_math"
        elif any(k in blob for k in ("bio", "cell", "gene", "dna", "rna", "protein", "medical", "clinical", "neuro", "ecology", "生物", "医学", "细胞", "基因", "蛋白", "神经", "生态", "分子")):
            cat = "bio_med"
        elif any(k in blob for k in ("history", "philosophy", "society", "economy", "literature", "law", "art", "culture", "历史", "哲学", "经济", "社会", "文学", "艺术", "人文", "法律")):
            cat = "humanities"
        else:
            cat = "ai_cs"

    p_name = str(raw_dict.get("planetName", "")).strip().strip("「」")
    if not p_name:
        if "transformer" in blob or "attention" in blob or "注意力" in blob:
            p_name = "矩心·自注意力界"
        elif "thermodynamic" in blob or "entropy" in blob or "热力学" in blob or "熵" in blob:
            p_name = "卡诺·熵增荒原"
        elif "randomization" in blob or "sim" in blob or "随机化" in blob:
            p_name = "拟真·域迁星原"
        elif "quantum" in blob or "量子" in blob:
            p_name = "叠态·相干星渊"
        else:
            bare = re.sub(r"\.pdf$", "", file_name, flags=re.IGNORECASE)
            bare = re.sub(r"^[\d._-]+", "", bare)
            bare = re.split(r"[_\-\s:：()（）]+", bare)[0][:6] or "未知"
            prefix = {"ai_cs": "矩心", "physics_math": "奇点", "bio_med": "生息", "humanities": "思辨"}[cat]
            suffix = {"ai_cs": "星界", "physics_math": "测地界", "bio_med": "翡翠海", "humanities": "回响谷"}[cat]
            p_name = f"{prefix}·{bare}{suffix}"

    summary = str(raw_dict.get("themeSummary", "")).strip()
    if not summary:
        bare_title = re.sub(r"\.pdf$", "", file_name, flags=re.IGNORECASE).strip() or "核心文献"
        summary = f"围绕《{bare_title[:28]}》构建的知识探索星界。"

    return {
        "planetName": f"「{p_name}」",
        "themeCategory": cat,
        "themeSummary": summary[:80],
    }


def _normalize_zones(
    raw: Any,
    min_count: int = MIN_PLAY_ZONES,
    max_count: int = MAX_PLAY_ZONES,
    id_offset: int = 0,
) -> Optional[List[Dict[str, Any]]]:
    items = raw.get("zones") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return None
    zones: List[Dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("zoneTitle") or "").strip()
        calibration = _normalize_calibration(item.get("calibration"))
        circuit = _normalize_quest_question(item.get("circuit"))
        boss = _normalize_feynman_boss(item.get("feynmanBoss"))
        if not title or calibration is None or circuit is None or boss is None:
            continue
        summary = str(item.get("summary") or item.get("zoneIntro") or "").strip()
        monolith = str(item.get("monolithNote", "")).strip() or boss["referenceExplanation"]
        zones.append({
            "id": f"zone-{id_offset + len(zones) + 1}",
            "title": title,
            "zoneTitle": title,
            "summary": summary,
            "zoneIntro": summary,
            "progress": 0,
            "monolithNote": monolith,
            "intel": _normalize_intel(item.get("intel"), boss, summary),
            "status": "locked",
            "calibration": calibration,
            "circuit": circuit,
            "feynmanBoss": boss,
            "gates": _normalize_gates(item.get("gates"), boss),
        })
        if len(zones) == max_count:
            break
    if len(zones) < min_count:
        return None
    return zones


def _normalize_outline(raw: Any, first: Dict[str, Any]) -> List[Dict[str, str]]:
    """Zone plan from the first-stage call; item 1 always mirrors the zone that was actually built."""
    items = raw.get("outline") if isinstance(raw, dict) else None
    outline: List[Dict[str, str]] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        if title and all(entry["title"] != title for entry in outline):
            outline.append({"title": title, "summary": str(item.get("summary", "")).strip()})
    head = {"title": first["title"], "summary": first["summary"]}
    if outline:
        outline[0] = head
    else:
        outline = [head]
    return outline[:MAX_PLAY_ZONES]


def _zone_prompt_inputs(document_id: str) -> Tuple[str, str, str]:
    record = get_document(document_id)
    if record is None:
        raise ValueError("Document not found.")

    units = load_knowledge_units(document_id) or []
    context = format_units_context(units) if units else ""
    if not context:
        context = _sample_document_context(get_all_chunks_for_document(document_id))
    if not context:
        raise ValueError("This document has no indexed text.")

    safe_name = str(record.get("name") or document_id).replace("{", "").replace("}", "")
    safe_context = context.replace("{", "(").replace("}", ")")
    return safe_name, safe_context, context


def _invoke_json(prompt: str, build: Any) -> Any:
    last_error = "Could not build knowledge zones from this document."
    for _ in range(2):
        try:
            response = llm.invoke(prompt)
            parsed = json.loads(_extract_json_from_response(extract_text(response).strip()))
            result = build(parsed)
            if result:
                return result
        except Exception as exc:
            last_error = str(exc)
    raise ValueError(last_error)


def _store_planet_meta(document_id: str, name: str, context: str, parsed: Any) -> None:
    try:
        update_document_meta(document_id, _infer_planet_meta(name, context[:600], parsed))
    except Exception:
        pass


def generate_zones(document_id: str) -> List[Dict[str, Any]]:
    """Build 4-6 surface knowledge zones (signal, circuit, Feynman guardian) from one PDF."""
    name, safe_context, context = _zone_prompt_inputs(document_id)
    prompt = PromptManager.get_zone_prompt().format(name=name, context=safe_context)

    def build(parsed: Any) -> Optional[List[Dict[str, Any]]]:
        zones = _normalize_zones(parsed)
        if zones:
            _store_planet_meta(document_id, name, context, parsed)
        return zones

    return _invoke_json(prompt, build)


def generate_first_zone(document_id: str) -> Dict[str, Any]:
    """First stage of progressive loading: planet identity, the zone plan, and full data for zone 1 only."""
    name, safe_context, context = _zone_prompt_inputs(document_id)
    prompt = PromptManager.get_zone_first_prompt().format(name=name, context=safe_context)

    def build(parsed: Any) -> Optional[Dict[str, Any]]:
        zones = _normalize_zones(parsed, min_count=1, max_count=1)
        if not zones:
            return None
        _store_planet_meta(document_id, name, context, parsed)
        return {"zones": zones, "outline": _normalize_outline(parsed, zones[0])}

    return _invoke_json(prompt, build)


def generate_rest_zones(document_id: str, outline: List[Dict[str, str]], start: int) -> List[Dict[str, Any]]:
    """Second stage: full data for the planned zones after the first, ids continue from `start`."""
    planned = [
        {"title": str(item.get("title", "")).strip(), "summary": str(item.get("summary", "")).strip()}
        for item in outline
        if isinstance(item, dict) and str(item.get("title", "")).strip()
    ][:MAX_PLAY_ZONES]
    if not planned:
        raise ValueError("Zone outline is empty.")
    name, safe_context, _ = _zone_prompt_inputs(document_id)

    def safe(text: str) -> str:
        return text.replace("{", "(").replace("}", ")")

    outline_text = "\n".join(
        f"{index + 1}. {safe(item['title'])}" + (f" —— {safe(item['summary'])}" if item["summary"] else "")
        for index, item in enumerate(planned)
    )
    prompt = PromptManager.get_zone_rest_prompt().format(name=name, context=safe_context, outline=outline_text)

    def build(parsed: Any) -> Optional[List[Dict[str, Any]]]:
        return _normalize_zones(parsed, min_count=1, max_count=len(planned), id_offset=start)

    return _invoke_json(prompt, build)


def _normalize_feynman_eval(raw: Any, point_count: int) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict) or point_count < 1:
        return None
    raw_scores = raw.get("scores")
    if not isinstance(raw_scores, list):
        return None
    scores: List[float] = []
    for value in raw_scores[:point_count]:
        try:
            score = float(value)
        except (TypeError, ValueError):
            score = 0.0
        scores.append(min(1.0, max(0.0, score)))
    scores.extend([0.0] * (point_count - len(scores)))
    resonance = round(sum(scores) / point_count * 100)
    if resonance >= 90:
        resonance = 100
    return {
        "resonance": resonance,
        "scores": scores,
        "reply": str(raw.get("reply", "")).strip(),
        "followUp": "" if resonance == 100 else str(raw.get("followUp", "")).strip(),
    }


def evaluate_feynman(
    title: str,
    guardian: str,
    challenge: str,
    key_points: List[str],
    reference: str,
    answer: str,
) -> Dict[str, Any]:
    """Score a learner's plain-language explanation against the zone's key points."""
    points = [str(point).strip() for point in key_points if str(point).strip()]
    if not points:
        raise ValueError("This zone has no key points.")
    if not answer.strip():
        raise ValueError("Empty explanation.")

    def safe(text: str) -> str:
        return str(text).replace("{", "(").replace("}", ")")

    formatted_prompt = PromptManager.get_feynman_prompt().format(
        guardian=safe(guardian or _DEFAULT_GUARDIAN),
        title=safe(title),
        challenge=safe(challenge),
        key_points="\n".join(f"{index + 1}. {safe(point)}" for index, point in enumerate(points)),
        reference=safe(reference),
        answer=safe(answer.strip()),
    )

    last_error = "Could not evaluate this explanation."
    judge = make_llm(temperature=0, timeout=30)
    for _ in range(2):
        try:
            response = judge.invoke(formatted_prompt)
            response_text = _extract_json_from_response(extract_text(response).strip())
            result = _normalize_feynman_eval(json.loads(response_text), len(points))
            if result:
                return result
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
