from app.rag.vector_store import similarity_search
from app.llm_factory import make_llm


# 1. Ask a question
question = "What is quantum computing?"


# 2. Retrieve relevant chunks
results = similarity_search(
    question,
    document_id="test-document-001",
    k=3
)

print("Retrieved chunks:", len(results))

for doc, score in results:
    print("\n--- Retrieved Chunk ---")
    print("Score:", score)
    print("Source:", doc.metadata.get("source"))
    print("Page:", doc.metadata.get("page"))
    print("Text:", doc.page_content)


# 3. Build context from retrieved chunks
context = "\n\n".join(
    doc.page_content
    for doc, score in results
)


# 4. Create chat model
llm = make_llm(temperature=0)


# 5. Ask the model using retrieved context
prompt = f"""
You are an AI tutor.

Answer the question using ONLY the context below.

Context:
{context}

Question:
{question}

If the context does not contain enough information, say:
"I don't have enough information in the document."

Answer clearly and simply.
"""


# 6. Generate answer
response = llm.invoke(prompt)

if isinstance(response.content, list):
    answer = "".join(
        block.get("text", "")
        for block in response.content
        if isinstance(block, dict)
    )
else:
    answer = response.content

print("FINAL ANSWER")
print("=" * 30)
print(answer)