"""Extract and persist per-document knowledge units from structural chunks."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable, Iterable

from langchain_core.documents import Document

from app.llm_factory import make_llm
from app.prompts.prompt_manager import PromptManager

logger = logging.getLogger(__name__)

MAX_EXTRACT_SECTIONS = 12
MIN_SECTION_CHARS = 800


def parse_units_payload(raw: Any) -> list[dict[str, Any]]:
    data = raw
    if isinstance(raw, str):
        text = raw.strip()
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
                text = text[start : end + 1]
        data = json.loads(text)
    if isinstance(data, dict):
        items = data.get("units", [])
    elif isinstance(data, list):
        items = data
    else:
        return []
    units: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        statement = str(item.get("statement", "")).strip()
        plain = str(item.get("plain", "")).strip()
        if not name or not statement:
            continue
        prereq_raw = item.get("prerequisites") or []
        if isinstance(prereq_raw, str):
            prerequisites = [prereq_raw.strip()] if prereq_raw.strip() else []
        elif isinstance(prereq_raw, list):
            prerequisites = [
                str(value).strip()
                for value in prereq_raw
                if str(value).strip()
            ]
        else:
            prerequisites = []
        units.append(
            {
                "name": name,
                "statement": statement,
                "prerequisites": prerequisites,
                "plain": plain,
            }
        )
    return units


def merge_units(groups: Iterable[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for group in groups:
        for unit in group:
            key = str(unit.get("name", "")).casefold()
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(unit)
    return merged


def coalesce_chunks(
    chunks: list[Document],
    max_sections: int = MAX_EXTRACT_SECTIONS,
    min_chars: int = MIN_SECTION_CHARS,
) -> list[str]:
    texts = [
        chunk.page_content.strip()
        for chunk in chunks
        if chunk.page_content and chunk.page_content.strip()
    ]
    if not texts:
        return []

    packed: list[str] = []
    buffer = ""
    for text in texts:
        if not buffer:
            buffer = text
            continue
        if len(buffer) < min_chars:
            buffer = f"{buffer}\n\n{text}"
            continue
        packed.append(buffer)
        buffer = text
    if buffer:
        packed.append(buffer)

    while len(packed) > max_sections:
        shortest = min(range(len(packed) - 1), key=lambda i: len(packed[i]) + len(packed[i + 1]))
        packed[shortest] = f"{packed[shortest]}\n\n{packed[shortest + 1]}"
        del packed[shortest + 1]
    return packed


def format_units_context(units: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    for index, unit in enumerate(units, start=1):
        prereq = ", ".join(unit.get("prerequisites") or []) or "无"
        blocks.append(
            "\n".join(
                [
                    f"[{index}] {unit.get('name', '')}",
                    f"陈述: {unit.get('statement', '')}",
                    f"前置: {prereq}",
                    f"人话: {unit.get('plain', '')}",
                ]
            )
        )
    return "\n\n".join(blocks)


def extract_units_from_chunks(
    chunks: list[Document],
    invoke: Callable[[str], str] | None = None,
) -> list[dict[str, Any]]:
    sections = coalesce_chunks(chunks)
    if not sections:
        return []

    def _invoke(prompt: str) -> str:
        if invoke is not None:
            return invoke(prompt)
        llm = make_llm(temperature=0)
        response = llm.invoke(prompt)
        content = getattr(response, "content", response)
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict):
                    parts.append(block.get("text", ""))
            return "".join(parts)
        return str(content)

    template = PromptManager.get_unit_prompt()
    groups: list[list[dict[str, Any]]] = []
    for section in sections:
        safe = section.replace("{", "(").replace("}", ")")
        try:
            raw = _invoke(template.format(context=safe))
            groups.append(parse_units_payload(raw))
        except Exception:
            logger.warning("Skipping knowledge-unit extraction for one section", exc_info=True)
    return merge_units(groups)
