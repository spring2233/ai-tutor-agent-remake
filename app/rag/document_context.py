"""Assemble tutor context so a question can see the whole uploaded PDF.

Similarity search only returns a few chunks. Questions about what the
document is, what it teaches, or what its insight is need the knowledge
map plus source text in reading order.
"""

from __future__ import annotations

import logging
import re

from langchain_core.documents import Document

from app.rag.knowledge_map import format_units_context
from app.rag.library import load_knowledge_units

logger = logging.getLogger(__name__)

ROLE_MAP = "knowledge_map"
ROLE_COVERAGE = "document_coverage"

# A typical paper fits. Longer PDFs are sampled from start to end.
SOURCE_CHAR_BUDGET = 60000
MAP_CHAR_BUDGET = 12000
MIN_SLICE_CHARS = 500

_OVERVIEW_RE = re.compile(
    r"主要讲|讲了什么|讲了哪些|哪些知识|什么知识|全文|整篇|整本|整份|"
    r"这份pdf|这篇论文|这份文档|这个文档|这份论文|这个pdf|这篇pdf|"
    r"总结|概括|大纲|核心观点|核心发现|主要贡献|"
    r"insight|洞察|启示|overview|summar(?:y|ize|ise)?|"
    r"main idea|main point|what is this (?:paper|pdf|document) about|"
    r"主要内容|整体内容"
)


def is_overview_question(question: str) -> bool:
    text = (question or "").strip().casefold()
    if not text:
        return False
    return _OVERVIEW_RE.search(text) is not None


def has_document_wide(documents: list) -> bool:
    for doc in documents or []:
        role = (getattr(doc, "metadata", None) or {}).get("role")
        if role in {ROLE_MAP, ROLE_COVERAGE}:
            return True
    return False


def _chunk_sort_key(doc: Document) -> int:
    try:
        return int((doc.metadata or {}).get("chunk_index"))
    except (TypeError, ValueError):
        return 10**9


def _even_indexes(count: int, slots: int) -> list[int]:
    if count <= 0:
        return []
    if slots <= 1 or count <= slots:
        return list(range(count))
    picked: list[int] = []
    for step in range(slots):
        index = round(step * (count - 1) / (slots - 1))
        if not picked or picked[-1] != index:
            picked.append(index)
    if picked[0] != 0:
        picked.insert(0, 0)
    if picked[-1] != count - 1:
        picked.append(count - 1)
    return picked


def _segment_label(index: int, total: int, doc: Document, excerpt: bool) -> str:
    page = (doc.metadata or {}).get("page")
    page_bit = ""
    if isinstance(page, int) or (isinstance(page, str) and str(page).isdigit()):
        page_bit = f"，第 {page} 页"
    kind = "节选" if excerpt else "原文"
    return f"--- 第 {index}/{total} 段（{kind}{page_bit}） ---"


def _map_text(units: list[dict], budget: int | None) -> str:
    selected = list(units)
    if budget is not None:
        while len(selected) > 1 and len(format_units_context(selected)) > budget:
            selected = selected[:-1]
    body = format_units_context(selected)
    if budget is not None and len(body) > budget:
        body = body[:budget].rstrip() + "…"
    note = (
        f"上传时已通读全文并抽出 {len(units)} 条知识单元，"
        "用来概括整份 PDF，不是某一段检索片段。"
    )
    if len(selected) < len(units):
        note += f" 此处列出前 {len(selected)} 条，用于定位整份文档的范围。"
    return f"【全书知识地图】\n{note}\n\n{body}"


def build_coverage(chunks: list[Document], budget: int = SOURCE_CHAR_BUDGET) -> tuple[str, bool]:
    """Return source text in reading order, and whether it is the full PDF."""

    ordered = [doc for doc in sorted(chunks, key=_chunk_sort_key) if (doc.page_content or "").strip()]
    if not ordered:
        return "", False

    texts = [doc.page_content.strip() for doc in ordered]
    total = sum(len(text) for text in texts)
    count = len(texts)

    if total <= budget:
        parts = [
            f"{_segment_label(index, count, doc, False)}\n{text}"
            for index, (doc, text) in enumerate(zip(ordered, texts), start=1)
        ]
        header = (
            f"【原文覆盖】\n下面是该 PDF 按阅读顺序的原文，共 {count} 段，已全部包含。"
            "回答整份文档在讲什么时以此为准，不要说材料只截到了其中某一节。\n\n"
        )
        return header + "\n\n".join(parts), True

    if count * MIN_SLICE_CHARS <= budget:
        per_chunk = max(MIN_SLICE_CHARS, budget // count)
        parts = []
        for index, (doc, text) in enumerate(zip(ordered, texts), start=1):
            excerpt = len(text) > per_chunk
            snippet = text if not excerpt else text[:per_chunk].rstrip() + "…"
            parts.append(f"{_segment_label(index, count, doc, excerpt)}\n{snippet}")
        header = (
            f"【原文覆盖】\n全文共 {count} 段，按阅读顺序每一段都保留了节选，从开头覆盖到结尾。\n\n"
        )
        return header + "\n\n".join(parts), False

    slots = max(2, budget // 2000)
    indexes = _even_indexes(count, slots)
    per_window = max(400, budget // max(1, len(indexes)))
    parts = []
    used = 0
    for index in indexes:
        if used >= budget:
            break
        text = texts[index]
        room = min(per_window, budget - used)
        if room < 200:
            break
        excerpt = len(text) > room
        snippet = text if not excerpt else text[:room].rstrip() + "…"
        parts.append(
            f"{_segment_label(index + 1, count, ordered[index], excerpt)}\n{snippet}"
        )
        used += len(snippet)
    header = (
        f"【原文覆盖】\n全文共 {count} 段，单次放不下，"
        f"下面按阅读顺序从开头到结尾均匀截取了 {len(parts)} 段。"
        "这是跨全文的覆盖，不是只命中某一节。\n\n"
    )
    return header + "\n\n".join(parts), False


def _source_name(
    chunks: list[Document] | None,
    retrieved: list[Document] | None,
    document_id: str,
) -> str:
    for doc in list(chunks or []) + list(retrieved or []):
        name = (doc.metadata or {}).get("source")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return document_id


def _tagged(
    text: str,
    role: str,
    source: str,
    document_id: str,
    **extra: object,
) -> Document:
    metadata: dict = {"role": role, "document_id": document_id}
    if source:
        metadata["source"] = source
    metadata.update(extra)
    return Document(page_content=text, metadata=metadata)


def assemble_context(
    question: str,
    retrieved: list[Document] | None,
    units: list[dict] | None,
    chunks: list[Document] | None,
    document_id: str = "",
) -> list[Document]:
    """Whole-document context for overview questions; map plus hits otherwise."""

    retrieved = list(retrieved or [])
    units = list(units or [])
    chunks = list(chunks or [])
    source = _source_name(chunks, retrieved, document_id)
    overview = is_overview_question(question)

    if overview:
        documents: list[Document] = []
        if units:
            documents.append(
                _tagged(_map_text(units, None), ROLE_MAP, source, document_id)
            )
        coverage, complete = build_coverage(chunks)
        if coverage:
            documents.append(
                _tagged(
                    coverage,
                    ROLE_COVERAGE,
                    source,
                    document_id,
                    complete=complete,
                )
            )
        if not documents:
            return retrieved
        if not complete and retrieved:
            documents.append(
                Document(
                    page_content=(
                        "【相关原文】\n下面几段是按这个问题额外检索到的原文，用来补细节。"
                    ),
                    metadata={
                        "role": "retrieved_header",
                        "source": source,
                        "document_id": document_id,
                    },
                )
            )
            documents.extend(retrieved)
        return documents

    documents = []
    if units:
        documents.append(
            _tagged(_map_text(units, MAP_CHAR_BUDGET), ROLE_MAP, source, document_id)
        )
    if retrieved:
        documents.append(
            Document(
                page_content=(
                    "【相关原文】\n下面几段是按这个问题检索到的原文。"
                    "具体数字、表格和原句以这些片段为准；知识地图用来说明它们在整份 PDF 里的位置。"
                ),
                metadata={
                    "role": "retrieved_header",
                    "source": source,
                    "document_id": document_id,
                },
            )
        )
        documents.extend(retrieved)
    return documents or retrieved


def expand_document_context(
    question: str,
    document_id: str,
    retrieved: list[Document],
) -> list[Document]:
    """Load the stored map and ordered chunks, then assemble tutor context."""

    units = None
    chunks = None
    try:
        units = load_knowledge_units(document_id)
    except Exception:
        logger.warning("Could not load knowledge map for %s", document_id, exc_info=True)
    try:
        from app.rag.vector_store import get_ordered_chunks

        chunks = get_ordered_chunks(document_id)
    except Exception:
        logger.warning("Could not load ordered chunks for %s", document_id, exc_info=True)

    context = assemble_context(
        question,
        retrieved or [],
        units,
        chunks,
        document_id=document_id or "",
    )
    logger.info(
        "Tutor context | overview=%s | units=%d | chunks=%d | retrieved=%d | context_docs=%d | chars=%d",
        is_overview_question(question),
        0 if not units else len(units),
        0 if not chunks else len(chunks),
        len(retrieved or []),
        len(context),
        sum(len(doc.page_content or "") for doc in context),
    )
    return context
