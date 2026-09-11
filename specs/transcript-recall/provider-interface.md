# Embedding Provider Interface — Transcript Recall

This spec defines the `EmbeddingProvider` interface for transcript recall and the expected migration path from the Phase 1 hashing provider to a real model.

## Interface (canonical)

```typescript
// packages/core/src/recall/provider.ts
import { Effect } from "effect"

export interface EmbeddingProvider {
  /** Stable identifier stored per row so stale vectors are detectable after a provider swap. */
  readonly id: string
  /** Vector dimension (fixed for this provider). 256 for hashing, 1536 for OpenAI 3-small, etc. */
  readonly dim: number
  /** Human-readable model name. */
  readonly modelID: string
  /** Embed a batch of texts. Returns Float32 vectors. */
  readonly embed: (texts: string[]) => Effect.Effect<Float32Array[]>
}
```

## Phase 1: HashingProvider (POC)

```typescript
const DIM = 256

function fnv1a(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function normalize(vec: Float32Array) {
  let sum = 0
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i]
  const norm = Math.sqrt(sum)
  if (norm === 0) return
  for (let i = 0; i < vec.length; i++) vec[i] /= norm
}

export const HashingProvider: EmbeddingProvider = {
  id: "hashing",
  dim: DIM,
  modelID: "char-trigram-v1",
  embed: (texts) =>
    Effect.sync(() =>
      texts.map((text) => {
        const vec = new Float32Array(DIM)
        const flat = ` ${text.toLowerCase().replace(/\s+/g, " ").trim()} `
        for (let i = 0; i + 3 <= flat.length; i++) {
          vec[fnv1a(flat.slice(i, i + 3)) % DIM] += 1
        }
        normalize(vec)
        return vec
      }),
    ),
}
```

### Properties

- **Deterministic**: same text always produces same vector
- **Zero deps**: pure CPU computation
- **Quality**: bag-of-character-trigrams — captures lexical similarity, weak on synonyms and semantics
- **Dimension**: 256 floats = 1 KB per chunk vector
- **Use case**: validating the index/retrieval pipeline before committing to a real model

## Phase 2: Swap to Real Model

The `EmbeddingProvider` interface allows swapping the hashing POC for a real embedding model without changing the indexer or tool.

### Migration Steps

1. **Implement** the `EmbeddingProvider` interface for the chosen model
2. **Wire** the provider selection (env var or config)
3. **Filter** stale rows: search excludes rows where `provider != currentProvider.id` OR `dim != currentProvider.dim`
4. **Re-embed** stale rows:
   - **Lazy**: only re-embed when the part changes (event-driven)
   - **Eager** (Phase 3): background job re-embeds all stale rows
   - **Manual**: `opencode recall rebuild` command

### Provider Mismatch Behavior

The indexer filters out rows from a different provider at search time (line 227 of `indexer.ts`):

```typescript
for (const row of rows) {
  if (row.dim !== provider.dim || row.provider !== provider.id) continue
  // ... cosine ...
}
```

This means:
- Switching providers **does not** crash
- Old rows are silently excluded (not deleted)
- Search returns results only from the current provider
- Until parts change, search covers only the new chunks

### Example: OpenAI `text-embedding-3-small`

```typescript
import { Effect } from "effect"
import OpenAI from "openai"

const openai = new OpenAI()

class OpenAIEmbeddingProvider {
  readonly id = "openai-embedding-3-small"
  readonly dim = 1536
  readonly modelID = "text-embedding-3-small"

  embed(texts: string[]) {
    return Effect.tryPromise({
      try: async () => {
        const res = await openai.embeddings.create({
          model: this.modelID,
          input: texts,
        })
        return res.data.map(d => new Float32Array(d.embedding))
      },
      catch: (e) => new Error(`OpenAI embed failed: ${e}`)
    })
  }
}
```

### Selection Mechanism

To swap providers, wire a config-driven selector at app bootstrap:

```typescript
// packages/opencode/src/effect/app-runtime.ts (Phase 2)
const provider = config.recallProvider === "openai"
  ? new OpenAIEmbeddingProvider()
  : HashingProvider
```

The default is `HashingProvider` (Phase 1). Phase 2 adds the opt-in.

## Considerations for Future Providers

| Provider | Dim | API | Cost/1M tokens | Notes |
|---|---|---|---|---|
| HashingProvider (POC) | 256 | none | free | current |
| OpenAI 3-small | 1536 | HTTPS | $0.02 | best price/quality |
| OpenAI 3-large | 3072 | HTTPS | $0.13 | highest quality |
| Vertex textembedding-gecko | 768 | HTTPS | varies | GCP-native |
| Local all-MiniLM-L6-v2 | 384 | local | free | no API key needed |
| Local all-mpnet-base-v2 | 768 | local | free | higher quality than MiniLM |
