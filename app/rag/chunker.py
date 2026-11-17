"""Split PDF pages on headings and paragraphs, keeping formulas intact."""

from __future__ import annotations

import re

from langchain_core.documents import Document

from app.rag.config import settings

_NAMED_HEADINGS = (
    "abstract",
    "introduction",
    "conclusion",
    "references",
    "acknowledgement",
    "acknowledgements",
    "related work",
    "method",
    "methods",
    "methodology",
    "experiment",
    "experiments",
    "discussion",
    "results",
    "background",
)

_NAMED_HEADING_RE = re.compile(
    r"^(?:%s)\b" % "|".join(re.escape(name) for name in _NAMED_HEADINGS),
    re.IGNORECASE,
)
_NUMBERED_HEADING_RE = re.compile(
    r"^\d+(?:\.\d+)*\.?\s+[A-Za-z\u4e00-\u9fff]"
)
_FORMULA_MARKERS = ("∑", "∫", "√", "±", "≤", "≥", "∞", "∂", "∇")


def _is_heading_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped or len(stripped) > 120:
        return False
    if _NAMED_HEADING_RE.match(stripped):
        return True
    if _NUMBERED_HEADING_RE.match(stripped) and len(stripped.split()) <= 16:
        return True
    return False


def _is_formula_paragraph(text: str) -> bool:
    if any(marker in text for marker in _FORMULA_MARKERS):
        return True
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if "=" in line and len(line) <= 160:
            return True
        symbolish = sum(
            char in "=-+*/^_()[]{}\\0123456789" or char in "".join(_FORMULA_MARKERS)
            for char in line
        )
        if len(line) < 80 and symbolish >= max(3, int(len(line) * 0.4)):
            return True
    return False


def _join_pages(pages: list[Document]) -> tuple[str, list[tuple[int, int]]]:
    parts: list[str] = []
    spans: list[tuple[int, int]] = []
    cursor = 0
    for page in pages:
        text = (page.page_content or "").strip()
        if not text:
            continue
        page_no = int(page.metadata.get("page", 0) or 0)
        if parts:
            cursor += 2
        spans.append((cursor, page_no))
        parts.append(text)
        cursor += len(text)
    return "\n\n".join(parts), spans


def _page_at(offset: int, spans: list[tuple[int, int]]) -> int:
    page = 0
    for start, page_no in spans:
        if start <= offset:
            page = page_no
        else:
            break
    return page


def _split_heading_sections(text: str) -> list[tuple[int, str]]:
    lines = text.splitlines(keepends=True)
    starts: list[int] = [0]
    offset = 0
    for index, line in enumerate(lines):
        if index > 0 and _is_heading_line(line):
            starts.append(offset)
        offset += len(line)
    starts = sorted(set(starts))
    sections: list[tuple[int, str]] = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(text)
        body = text[start:end].strip()
        if body:
            sections.append((start, body))
    return sections or [(0, text.strip())]


def _paragraphs(section: str) -> list[str]:
    parts = re.split(r"\n\s*\n", section)
    return [part.strip() for part in parts if part.strip()]


def _split_oversized(paragraph: str, max_size: int) -> list[str]:
    if len(paragraph) <= max_size:
        return [paragraph]
    lines = paragraph.splitlines()
    if len(lines) > 1:
        packed: list[str] = []
        buf: list[str] = []
        size = 0
        for line in lines:
            extra = len(line) + (1 if buf else 0)
            if buf and size + extra > max_size and not _is_formula_paragraph(line):
                packed.append("\n".join(buf))
                buf = [line]
                size = len(line)
            else:
                buf.append(line)
                size += extra
        if buf:
            packed.append("\n".join(buf))
        return packed
    pieces: list[str] = []
    rest = paragraph
    while len(rest) > max_size:
        window = rest[:max_size]
        cut = window.rfind("\n")
        if cut < max_size // 2:
            cut = window.rfind(". ")
            cut = cut + 2 if cut >= max_size // 3 else max_size
        # Do not cut on an equals sign.
        if window[cut - 1 : cut + 1].find("=") != -1:
            safer = window.rfind(" ", 0, cut)
            cut = safer if safer >= max_size // 3 else cut
        pieces.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        pieces.append(rest)
    return pieces


def _pack_paragraphs(
    paragraphs: list[str],
    min_size: int,
    max_size: int,
    overlap: int,
) -> list[str]:
    atoms: list[str] = []
    for paragraph in paragraphs:
        atoms.extend(_split_oversized(paragraph, max_size))
    if not atoms:
        return []

    chunks: list[str] = []
    buffer: list[str] = []
    size = 0
    index = 0

    def flush() -> str:
        return "\n\n".join(buffer)

    while index < len(atoms):
        para = atoms[index]
        extra = len(para) + (2 if buffer else 0)
        would_exceed = buffer and size + extra > max_size
        formula_bridge = would_exceed and (
            _is_formula_paragraph(para) or _is_formula_paragraph(buffer[-1])
        )
        if not would_exceed or (formula_bridge and size < max_size * 1.4):
            buffer.append(para)
            size += extra
            index += 1
            if formula_bridge and index < len(atoms) and not _is_formula_paragraph(atoms[index]):
                follow = atoms[index]
                buffer.append(follow)
                size += len(follow) + 2
                index += 1
            continue

        if size < min_size:
            buffer.append(para)
            size += extra
            index += 1
            continue

        remaining = len(para) + sum(len(atom) + 2 for atom in atoms[index + 1 :])
        if remaining < min_size:
            buffer.extend(atoms[index:])
            break

        text = flush()
        chunks.append(text)
        tail = text[-overlap:] if overlap and len(text) > overlap else ""
        buffer = [tail] if tail else []
        size = len(tail)

    if buffer:
        leftover = flush().strip()
        if leftover:
            chunks.append(leftover)
    return chunks


def chunk_pages(
    pages: list[Document],
    document_id: str,
    source_name: str,
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> list[Document]:
    """
    Split PDF pages into heading/paragraph chunks and attach metadata
    required by the downstream RAG pipeline.
    """
    target = chunk_size if chunk_size is not None else settings.chunk_size
    overlap = (
        chunk_overlap if chunk_overlap is not None else settings.chunk_overlap
    )
    min_size = max(200, int(target * 0.6))
    max_size = max(min_size, int(target * 1.2))

    joined, spans = _join_pages(pages)
    if not joined.strip():
        return []

    chunks: list[Document] = []
    for start, section in _split_heading_sections(joined):
        packed = _pack_paragraphs(_paragraphs(section), min_size, max_size, overlap)
        for body in packed:
            chunks.append(
                Document(
                    page_content=body,
                    metadata={
                        "document_id": document_id,
                        "source": source_name,
                        "page": _page_at(start, spans),
                        "chunk_index": len(chunks),
                    },
                )
            )

    for index, chunk in enumerate(chunks):
        chunk.metadata["chunk_index"] = index
    return chunks
