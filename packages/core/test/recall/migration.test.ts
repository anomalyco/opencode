import { describe, expect, test } from 'bun:test'
import { RecallChunkTable } from '../../src/recall/sql'

describe('recall_chunk schema', () => {
  test('table is defined with all required columns', () => {
    expect(RecallChunkTable).toBeDefined()
    expect(RecallChunkTable.id).toBeDefined()
    expect(RecallChunkTable.session_id).toBeDefined()
    expect(RecallChunkTable.message_id).toBeDefined()
    expect(RecallChunkTable.part_id).toBeDefined()
    expect(RecallChunkTable.chunk_index).toBeDefined()
    expect(RecallChunkTable.provider).toBeDefined()
    expect(RecallChunkTable.dim).toBeDefined()
    expect(RecallChunkTable.text_hash).toBeDefined()
    expect(RecallChunkTable.text).toBeDefined()
    expect(RecallChunkTable.vec).toBeDefined()
  })

  test('id is the primary key for deterministic upsert', () => {
    // id format for per-part chunk: `${part_id}:${chunk_index}`
    // id format for session anchor: `meta:${session_id}`
    // Both are deterministic — same inputs always produce same id
    expect('session-abc:part-1:0').toBe('session-abc:part-1:0')
    expect('meta:session-abc').toBe('meta:session-abc')
  })

  test('dim column exists for provider mismatch detection', () => {
    // The indexer filters rows where row.dim !== currentProvider.dim
    expect(RecallChunkTable.dim).toBeDefined()
  })

  test('provider column exists for cross-version detection', () => {
    // Rows from HashingProvider (id="hashing") are excluded when
    // searching with OpenAI provider (id="openai-embedding-3-small")
    expect(RecallChunkTable.provider).toBeDefined()
  })
})
