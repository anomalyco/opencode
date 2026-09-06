---
name: rag-architect
description: Designs and implements production-grade RAG systems by chunking documents, generating embeddings, configuring vector stores, building hybrid search pipelines, applying reranking, and evaluating retrieval quality. Use when building RAG systems, vector databases, or knowledge-grounded AI applications requiring semantic search, document retrieval, context augmentation, similarity search, or embedding-based indexing.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: data-ml
  triggers: RAG, retrieval-augmented generation, vector search, embeddings, semantic search, vector database, document retrieval, knowledge base, context retrieval, similarity search
  role: architect
  scope: system-design
  output-format: architecture
  related-skills: python-pro, database-optimizer, monitoring-expert, api-designer
---

# RAG Architect

## Core Workflow

1. **Requirements Analysis** — Identify retrieval needs, latency constraints, accuracy requirements, and scale
2. **Vector Store Design** — Select database, schema design, indexing strategy, sharding approach
3. **Chunking Strategy** — Document splitting, overlap, semantic boundaries, metadata enrichment
4. **Retrieval Pipeline** — Embedding selection, query transformation, hybrid search, reranking
5. **Evaluation & Iteration** — Metrics tracking, retrieval debugging, continuous optimization

For each step, validate before moving on (see checkpoints below).

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Vector Databases | `references/vector-databases.md` | Comparing Pinecone, Weaviate, Chroma, pgvector, Qdrant |
| Embedding Models | `references/embedding-models.md` | Selecting embeddings, fine-tuning, dimension trade-offs |
| Chunking Strategies | `references/chunking-strategies.md` | Document splitting, overlap, semantic chunking |
| Retrieval Optimization | `references/retrieval-optimization.md` | Hybrid search, reranking, query expansion, filtering |
| RAG Evaluation | `references/rag-evaluation.md` | Metrics, evaluation frameworks, debugging retrieval |

## Implementation Examples

### 1. Chunking Documents

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

# Evaluate chunk_size on your domain data — never use 512 blindly
splitter = RecursiveCharacterTextSplitter(
    chunk_size=800,
    chunk_overlap=100,
    separators=["\n\n", "\n", ". ", " "],
)

chunks = splitter.create_documents(
    texts=[doc.page_content for doc in raw_docs],
    metadatas=[{"source": doc.metadata["source"], "timestamp": doc.metadata.get("timestamp")} for doc in raw_docs],
)
```

**Checkpoint:** `assert all(c.metadata.get("source") for c in chunks), "Missing source metadata"`

### 2. Generating Embeddings & Indexing

```python
from openai import OpenAI
import qdrant_client
from qdrant_client.models import VectorParams, Distance, PointStruct

client = OpenAI()
qdrant = qdrant_client.QdrantClient("localhost", port=6333)

# Create collection
qdrant.recreate_collection(
    collection_name="knowledge_base",
    vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
)

def embed_chunks(chunks: list[str], model: str = "text-embedding-3-small") -> list[list[float]]:
    response = client.embeddings.create(input=chunks, model=model)
    return [r.embedding for r in response.data]

# Idempotent upsert with deduplication via deterministic IDs
import hashlib, uuid

points = []
for i, chunk in enumerate(chunks):
    doc_id = str(uuid.UUID(hashlib.md5(chunk.page_content.encode()).hexdigest()))
    embedding = embed_chunks([chunk.page_content])[0]
    points.append(PointStruct(id=doc_id, vector=embedding, payload=chunk.metadata))

qdrant.upsert(collection_name="knowledge_base", points=points)
```

**Checkpoint:** `assert qdrant.count("knowledge_base").count == len(set(p.id for p in points)), "Deduplication failed"`

### 3. Hybrid Search (Vector + BM25)

```python
from qdrant_client.models import Filter, FieldCondition, MatchValue, SparseVector
from rank_bm25 import BM25Okapi

def hybrid_search(query: str, tenant_id: str, top_k: int = 20) -> list:
    # Dense retrieval
    query_embedding = embed_chunks([query])[0]
    tenant_filter = Filter(must=[FieldCondition(key="tenant_id", match=MatchValue(value=tenant_id))])
    dense_results = qdrant.search(
        collection_name="knowledge_base",
        query_vector=query_embedding,
        query_filter=tenant_filter,
        limit=top_k,
    )

    # Sparse retrieval (BM25)
    corpus = [r.payload.get("text", "") for r in dense_results]
    bm25 = BM25Okapi([doc.split() for doc in corpus])
    bm25_scores = bm25.get_scores(query.split())

    # Reciprocal Rank Fusion
    ranked = sorted(
        zip(dense_results, bm25_scores),
        key=lambda x: 0.6 * x[0].score + 0.4 * x[1],
        reverse=True,
    )
    return [r for r, _ in ranked[:top_k]]
```

**Checkpoint:** `assert len(hybrid_search("test query", tenant_id="demo")) > 0, "Hybrid search returned no results"`

### 4. Reranking Top-K Results

Load provider API keys from environment variables or a secrets manager; never commit them to source code.

```python
import os

import cohere

co = cohere.Client(os.environ["COHERE_API_KEY"])

def rerank(query: str, results: list, top_n: int = 5) -> list:
    docs = [r.payload.get("text", "") for r in results]
    reranked = co.rerank(query=query, documents=docs, top_n=top_n, model="rerank-english-v3.0")
    return [results[r.index] for r in reranked.results]
```

### 5. Retrieval Evaluation

```python
# Run precision@k and recall@k against a labeled evaluation set
# python evaluate.py --metrics precision@10 recall@10 mrr --collection knowledge_base

from ragas import evaluate
from ragas.metrics import context_precision, context_recall, faithfulness, answer_relevancy
from datasets import Dataset

eval_dataset = Dataset.from_dict({
    "question": questions,
    "contexts": retrieved_contexts,
    "answer": generated_answers,
    "ground_truth": ground_truth_answers,
})

results = evaluate(eval_dataset, metrics=[context_precision, context_recall, faithfulness, answer_relevancy])
print(results)
```

**Checkpoint:** Target `context_precision >= 0.7` and `context_recall >= 0.6` before moving to LLM integration.

## Constraints

### MUST DO
- Evaluate multiple embedding models on your domain data before committing
- Implement hybrid search (vector + keyword) for production systems
- Add metadata filters for multi-tenant or domain-specific retrieval
- Measure retrieval metrics (precision@k, recall@k, MRR, NDCG)
- Use reranking for top-k results before passing context to LLM
- Implement idempotent ingestion with deduplication (deterministic IDs)
- Monitor retrieval latency and quality over time
- Version embeddings and plan for model migration

### MUST NOT DO
- Use default chunk size (512) without evaluation on your domain data
- Skip metadata enrichment (source, timestamp, section)
- Ignore retrieval quality metrics in favor of only LLM output quality
- Store raw documents without preprocessing/cleaning
- Use cosine similarity alone for complex multi-domain retrieval
- Deploy without testing on production-like data volumes
- Forget to handle edge cases (empty results, malformed docs)
- Couple the embedding model tightly to application code

## Output Templates

When designing RAG architecture, deliver:
1. System architecture diagram (ingestion + retrieval pipelines)
2. Vector database selection with trade-off analysis
3. Chunking strategy with examples and rationale
4. Retrieval pipeline design (query → results flow)
5. Evaluation plan with metrics, benchmarks, and pass/fail thresholds

[Documentation](https://jeffallan.github.io/claude-skills/skills/data-ml/rag-architect/)
