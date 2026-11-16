from io import BytesIO
from pathlib import Path

from langchain_core.documents import Document
from pypdf import PdfReader
from pypdf.errors import PdfReadError, PdfStreamError


def parse_pdf_bytes(content: bytes, source_name: str) -> list[Document]:
    """
    Parse PDF bytes in memory and return one LangChain Document per page.

    Avoids Windows temp-file reopen / mmap issues that surface as
    ``[Errno 22] Invalid argument``.
    """
    if not content:
        raise ValueError("PDF is empty.")

    try:
        reader = PdfReader(BytesIO(content))
    except (PdfReadError, PdfStreamError, OSError) as exc:
        raise ValueError(
            "无法读取这份 PDF。文件可能已损坏、受密码保护，"
            "或当前系统无法打开临时文件。"
        ) from exc

    pages: list[Document] = []
    for index, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        pages.append(
            Document(
                page_content=text,
                metadata={
                    "page": index,
                    "source": source_name,
                    "document_id": source_name,
                },
            )
        )

    if not pages:
        raise ValueError(
            f"No extractable text found in {source_name}. "
            "This may be a scanned/image-only PDF that needs OCR."
        )

    return pages


def parse_pdf(file_path: str) -> list[Document]:
    """
    Load a PDF and return one LangChain Document per page.

    Raises:
        FileNotFoundError: If the PDF does not exist.
        ValueError: If the file is not a PDF or contains no extractable text.
    """

    path = Path(file_path)

    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {file_path}")

    if path.suffix.lower() != ".pdf":
        raise ValueError(f"Expected a .pdf file, got: {path.suffix}")

    return parse_pdf_bytes(path.read_bytes(), source_name=path.name)


def get_pdf_page_count(file_path: str) -> int:
    """
    Return the number of pages containing extracted documents.
    """
    return len(parse_pdf(file_path))
