<!-- Context: development/storage | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# Concept: Mastra Data Storage

**Purpose**: Persistence layer for cases, documents, assessments, and observability.

**Last Updated**: 2026-01-09

---

## Core Idea
Mastra uses a dual-storage approach: a local SQLite database (via Drizzle ORM) for business entities and a built-in `LibSQLStore` for Mastra-specific execution data (traces, spans).

## Key Points
- **Business Entities**: Managed in `src/db/schema.ts`. Includes `cases`, `documents`, `assessments`, and `outputs`.
- **Mastra Store**: `LibSQLStore` handles `mastra_traces`, `mastra_ai_spans`, and `mastra_scorers`.
- **V3 Extensions**: Specific tables for `timeline_events`, `evidence_gaps`, `sub_claims`, and `vulnerability_flags`.
- **Observability**: `prompt_execution_traces` provides detailed cost and token tracking per AI call.
- **File Storage**: Large blobs (PDFs, JSON outputs) are stored in `./tmp/` with paths referenced in the DB.

## Quick Example
```typescript
// Business Schema (Drizzle)
export const cases = sqliteTable('cases', {
  id: text('id').primaryKey(),
  status: text('status').default('new'),
});

// Mastra Store Config
storage: new LibSQLStore({
  url: process.env.MASTRA_DB_PATH || 'file:./mastra.db',
}),
```

**Reference**: `src/db/schema.ts`, `src/mastra/index.ts`
**Related**:
- concepts/core.md
- lookup/mastra-config.md
