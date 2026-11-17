from langchain_core.documents import Document

from app.rag.chunker import chunk_pages


def _page(text: str, page: int = 0) -> Document:
    return Document(page_content=text, metadata={"page": page})


def test_numbered_headings_start_new_chunks():
    intro = "1. Intro\n\n" + ("alpha paragraph. " * 120)
    methods = "2.1 Methods\n\n" + ("beta paragraph. " * 120)
    chunks = chunk_pages(
        pages=[_page(intro + "\n\n" + methods)],
        document_id="docid12abcd",
        source_name="paper.pdf",
    )
    assert len(chunks) >= 2
    assert "Intro" in chunks[0].page_content
    assert "beta paragraph" not in chunks[0].page_content
    assert any("Methods" in chunk.page_content for chunk in chunks[1:])


def test_short_paragraphs_merge_into_one_chunk():
    body = "\n\n".join(f"Paragraph {index} with enough words here." for index in range(8))
    chunks = chunk_pages(
        pages=[_page("Abstract\n\n" + body)],
        document_id="docid12abcd",
        source_name="paper.pdf",
    )
    assert len(chunks) == 1
    assert "Paragraph 0" in chunks[0].page_content
    assert "Paragraph 7" in chunks[0].page_content


def test_formula_paragraph_is_not_split_on_equals():
    lead = ("The force law is introduced here. " * 90).strip()
    formula = "F = ma"
    follow = "The same relation holds instantaneously after the rope is cut."
    filler = ("Next we discuss frictionless planes in detail. " * 80).strip()
    text = f"1. Force\n\n{lead}\n\n{formula}\n\n{follow}\n\n{filler}"
    chunks = chunk_pages(
        pages=[_page(text)],
        document_id="docid12abcd",
        source_name="paper.pdf",
    )
    joined = "\n".join(chunk.page_content for chunk in chunks)
    assert "F = ma" in joined
    for chunk in chunks:
        body = chunk.page_content
        if "F = ma" in body:
            assert "F =" not in body.replace("F = ma", "")
            assert "ma" in body


def test_chunk_length_stays_in_band_except_short_docs():
    text = "Introduction\n\n" + ("Learning transfer needs enough context. " * 400)
    chunks = chunk_pages(
        pages=[_page(text)],
        document_id="docid12abcd",
        source_name="paper.pdf",
    )
    assert chunks
    for chunk in chunks:
        length = len(chunk.page_content)
        assert 1500 <= length <= 5000


def test_overlap_when_a_long_section_is_split():
    text = "1. Long\n\n" + ("Same idea continues across many sentences here. " * 250)
    chunks = chunk_pages(
        pages=[_page(text)],
        document_id="docid12abcd",
        source_name="paper.pdf",
    )
    assert len(chunks) >= 2
    tail = chunks[0].page_content[-200:]
    assert tail in chunks[1].page_content


def test_metadata_is_attached():
    chunks = chunk_pages(
        pages=[_page("Abstract\n\nA short abstract.", page=2)],
        document_id="docid12abcd",
        source_name="paper.pdf",
    )
    assert chunks[0].metadata["document_id"] == "docid12abcd"
    assert chunks[0].metadata["source"] == "paper.pdf"
    assert chunks[0].metadata["chunk_index"] == 0
    assert chunks[0].metadata["page"] == 2
