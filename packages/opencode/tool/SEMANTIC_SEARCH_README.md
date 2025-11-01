# Fast Semantic Search Tools

Lightning-fast semantic code search with two implementations: local AI (free) and OpenAI API.

## Overview

These tools provide semantic search capabilities for your codebase, allowing you to search using natural language and AI understanding rather than just keywords.

### Two Implementations

1. **Local AI** (`fast-semantic-search.ts`) - 100% free, privacy-friendly, 10-50ms search
2. **OpenAI API** (`index-codebase.ts`) - Cloud-based, higher quality embeddings

## Tools Available

### Local AI (Recommended)

#### `index_codebase_local`

Create an embeddings index using local AI (no API key required).

**Features:**

- Uses Xenova/all-MiniLM-L6-v2 model (384 dimensions)
- 100% FREE - no API costs
- Privacy-friendly - all processing local
- ~8000 char chunks with overlap

**Usage:**

```typescript
// Index up to 200 files (default)
await index_codebase_local.execute({}, ctx)

// Index more files with custom chunk size
await index_codebase_local.execute(
  {
    max_files: 500,
    chunk_size: 10000,
  },
  ctx,
)
```

**Output:** `.opencode/embeddings-local.json`

#### `fast_semantic_search`

Search the codebase using local AI embeddings.

**Features:**

- 10-50ms search times
- In-memory index caching (5 minute TTL)
- Query embedding cache (stores last 100 queries)
- Hybrid mode with keyword pre-filtering
- Zero API costs

**Usage:**

```typescript
// Basic search
await fast_semantic_search.execute(
  {
    query: "authentication logic",
  },
  ctx,
)

// Get more results without hybrid filtering
await fast_semantic_search.execute(
  {
    query: "error handling patterns",
    top_k: 10,
    use_hybrid: false,
  },
  ctx,
)
```

### OpenAI API

#### `index_codebase`

Create an embeddings index using OpenAI's text-embedding-3-small.

**Features:**

- Higher quality embeddings (1536 dimensions)
- Larger chunks (16000 chars, ~4K tokens)
- Batch processing (20 files at a time)
- Estimated cost displayed

**Requirements:**

- `OPENAI_API_KEY` environment variable
- `ai` and `@ai-sdk/openai` packages (already installed)

**Usage:**

```typescript
// Index with defaults
await index_codebase.execute({}, ctx)

// Custom configuration
await index_codebase.execute(
  {
    max_files: 300,
    chunk_size: 20000,
  },
  ctx,
)
```

**Output:** `.opencode/embeddings.json`

**Cost:** ~$0.0001 per file (very cheap!)

#### `semantic_search_code`

Search using OpenAI embeddings.

**Features:**

- Higher quality semantic matching
- In-memory index caching (1 minute TTL)
- Fast cached lookups

**Usage:**

```typescript
await semantic_search_code.execute(
  {
    query: "database connection pooling",
    top_k: 5,
  },
  ctx,
)
```

#### `hybrid_search_code`

Combines keyword filtering with semantic ranking.

**Usage:**

```typescript
await hybrid_search_code.execute(
  {
    query: "React component lifecycle",
    top_k: 8,
    keyword_filter: true,
  },
  ctx,
)
```

## Comparison

| Feature        | Local AI    | OpenAI API     |
| -------------- | ----------- | -------------- |
| **Cost**       | FREE        | ~$0.0001/file  |
| **Speed**      | 10-50ms     | 100-300ms      |
| **Privacy**    | 100% local  | Cloud API      |
| **Quality**    | Good (384d) | Better (1536d) |
| **Setup**      | Zero config | API key needed |
| **Chunk Size** | 8K chars    | 16K chars      |

## Workflow

### Using Local AI (Recommended)

```bash
# 1. Index your codebase (one time)
> Use tool: index_codebase_local

# 2. Search as needed (instant!)
> Use tool: fast_semantic_search with query "authentication"
> Use tool: fast_semantic_search with query "error handling"
> Use tool: fast_semantic_search with query "database queries"

# 3. Re-index when code changes significantly
> Use tool: index_codebase_local
```

### Using OpenAI API

```bash
# 1. Set API key
export OPENAI_API_KEY="sk-..."

# 2. Index codebase
> Use tool: index_codebase

# 3. Search
> Use tool: semantic_search_code with query "authentication"
```

## Performance Tips

### For Local AI:

- **Enable hybrid mode** (default) - filters candidates with keywords first
- **Cache is automatic** - repeated searches are instant
- **Model loads once** - first search takes ~2s, then cached
- **Query cache** - identical queries return immediately

### For OpenAI API:

- **Batch indexing** - processes 20 files at once
- **Index caching** - index stays in memory for 1 minute
- **Use hybrid_search** - combines best of keyword + semantic

## File Sizes

Typical index sizes for a medium codebase (200 files):

- **Local AI**: 15-25 MB (384 dimensions)
- **OpenAI API**: 60-100 MB (1536 dimensions)

Both are loaded into memory and cached for fast access.

## Complementary to RAID

These tools complement the RAID system:

- **Fast Search**: Quick code exploration, instant lookups
- **RAID**: Deep document understanding, multi-source queries, AI orchestration

Use Fast Search for navigation, use RAID for comprehension.

## Dependencies

Already installed:

- `@xenova/transformers` - Local AI models
- `@ai-sdk/openai` - OpenAI SDK
- `ai` - Vercel AI SDK

## Troubleshooting

### "No embeddings index found"

Run `index_codebase_local` or `index_codebase` first.

### "Model loading takes too long"

First run downloads the model (~90MB). Subsequent runs are instant.

### "OpenAI API error"

Check that `OPENAI_API_KEY` environment variable is set.

### "Out of memory"

Reduce `max_files` or `chunk_size` parameters.

## Examples

### Find authentication code

```typescript
fast_semantic_search.execute(
  {
    query: "user authentication and session management",
  },
  ctx,
)
```

### Find error handling patterns

```typescript
fast_semantic_search.execute(
  {
    query: "try catch error handling patterns",
    top_k: 10,
  },
  ctx,
)
```

### Find API endpoints

```typescript
fast_semantic_search.execute(
  {
    query: "REST API route handlers and controllers",
  },
  ctx,
)
```

### Find database queries

```typescript
fast_semantic_search.execute(
  {
    query: "SQL queries and database operations",
  },
  ctx,
)
```

## License

MIT
