"""
app/rag/vector_store.py

Owns all direct interaction with ChromaDB: adding chunks, deleting a
document's chunks, and low-level similarity search. retriever.py builds on
top of this — this module has no knowledge of grading, generation, or the
RAG pipeline, it's purely storage.
"""

from functools import lru_cache

from langchain_core.documents import Document
from langchain_chroma import Chroma

from app.rag.config import settings
from app.rag.embeddings import get_embedding_model


@lru_cache(maxsize=1)
def get_vectorstore() -> Chroma:
    """
    Return the shared ChromaDB vector store.

    All uploaded documents are stored in the same collection.
    Documents are separated using the 'document_id' metadata field.
    """
    return Chroma(
        collection_name=settings.chroma_collection_name,
        embedding_function=get_embedding_model(),
        persist_directory=settings.chroma_persist_dir,
    )


def add_chunks(chunks: list[Document]) -> None:
    """
    Add already-chunked Documents to ChromaDB.

    The Documents should already contain metadata such as:
    document_id, source, and chunk_index.
    """
    if not chunks:
        return

    get_vectorstore().add_documents(chunks)


def delete_document(document_id: str) -> None:
    """
    Delete all chunks belonging to a specific document.
    """
    if not document_id:
        raise ValueError("document_id cannot be empty.")

    vectorstore = get_vectorstore()

    vectorstore._collection.delete(
        where={"document_id": document_id}
    )


def similarity_search(
    query: str,
    document_id: str | None = None,
    k: int | None = None,
) -> list[tuple[Document, float]]:
    """
    Search ChromaDB using L2 distance.

    Returns:
        List of (Document, distance) tuples.
        Lower distance means higher similarity.
    """
    if not query.strip():
        raise ValueError("Query cannot be empty.")

    vectorstore = get_vectorstore()

    filter_dict = (
        {"document_id": document_id}
        if document_id
        else None
    )

    return vectorstore.similarity_search_with_score(
        query,
        k=k if k is not None else settings.retrieval_k,
        filter=filter_dict,
    )


def get_all_chunks_for_document(
    document_id: str,
) -> list[str]:
    """
    Fetch all stored chunk texts belonging to a document.
    """
    if not document_id:
        raise ValueError("document_id cannot be empty.")

    vectorstore = get_vectorstore()

    result = vectorstore.get(
        where={"document_id": document_id}
    )

    return result.get("documents", [])


def get_ordered_chunks(document_id: str) -> list[Document]:
    """
    Fetch every chunk of one document in reading order.
    """
    if not document_id:
        raise ValueError("document_id cannot be empty.")

    result = get_vectorstore().get(
        where={"document_id": document_id},
        include=["documents", "metadatas"],
    )
    texts = result.get("documents") or []
    metas = result.get("metadatas") or []
    documents: list[Document] = []
    for index, text in enumerate(texts):
        if not text or not str(text).strip():
            continue
        raw_meta = metas[index] if index < len(metas) and isinstance(metas[index], dict) else {}
        metadata = dict(raw_meta)
        metadata.setdefault("document_id", document_id)
        documents.append(Document(page_content=str(text), metadata=metadata))

    def sort_key(doc: Document) -> int:
        try:
            return int(doc.metadata.get("chunk_index"))
        except (TypeError, ValueError):
            return 10**9

    documents.sort(key=sort_key)
    return documents