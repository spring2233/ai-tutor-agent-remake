from langchain_core.documents import Document

from app.rag.knowledge_map import (
    coalesce_chunks,
    extract_units_from_chunks,
    format_units_context,
    merge_units,
    parse_units_payload,
)


def test_parse_units_payload_from_fenced_json():
    raw = """```json
{"units": [
  {"name": "Newton II", "statement": "F = ma", "prerequisites": ["mass"], "plain": "力决定加速度。"}
]}
```"""
    units = parse_units_payload(raw)
    assert units[0]["name"] == "Newton II"
    assert units[0]["statement"] == "F = ma"
    assert units[0]["prerequisites"] == ["mass"]


def test_parse_units_skips_incomplete_rows():
    units = parse_units_payload(
        {
            "units": [
                {"name": "", "statement": "x"},
                {"name": "OnlyName"},
                {"name": "Keep", "statement": "full", "plain": "hi"},
            ]
        }
    )
    assert [item["name"] for item in units] == ["Keep"]


def test_merge_units_dedupes_by_name():
    merged = merge_units(
        [
            [{"name": "A", "statement": "1", "prerequisites": [], "plain": "p"}],
            [{"name": "a", "statement": "2", "prerequisites": [], "plain": "q"}],
            [{"name": "B", "statement": "3", "prerequisites": [], "plain": "r"}],
        ]
    )
    assert [item["name"] for item in merged] == ["A", "B"]


def test_coalesce_chunks_merges_short_sections():
    chunks = [
        Document(page_content="x" * 900),
        Document(page_content="short a"),
        Document(page_content="y" * 900),
    ]
    packed = coalesce_chunks(chunks, max_sections=12, min_chars=800)
    assert len(packed) == 2
    assert packed[0].startswith("x")
    assert "short a" in packed[1]


def test_extract_units_from_chunks_uses_invoke_and_skips_bad_sections():
    chunks = [
        Document(page_content="alpha " * 200),
        Document(page_content="beta " * 200),
    ]
    calls = {"n": 0}

    def fake_invoke(_prompt: str) -> str:
        calls["n"] += 1
        if calls["n"] == 1:
            raise ValueError("boom")
        return '{"units": [{"name": "Beta", "statement": "beta holds", "prerequisites": [], "plain": "ok"}]}'

    units = extract_units_from_chunks(chunks, invoke=fake_invoke)
    assert calls["n"] == 2
    assert units == [
        {
            "name": "Beta",
            "statement": "beta holds",
            "prerequisites": [],
            "plain": "ok",
        }
    ]


def test_format_units_context_lists_fields():
    text = format_units_context(
        [
            {
                "name": "Force",
                "statement": "F = ma",
                "prerequisites": ["mass"],
                "plain": "push harder, speed up more",
            }
        ]
    )
    assert "[1] Force" in text
    assert "F = ma" in text
    assert "mass" in text
