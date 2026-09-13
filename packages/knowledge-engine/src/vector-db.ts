import { Database } from 'bun:sqlite';
import { statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import type { KnowledgeChunk, RetrievalResult, SearchOptions, IndexStats } from './types';
import { LocalEmbedder } from './embedder';
import { applyAbstentionGate } from './abstention';

export const KNOWLEDGE_DB_FILENAME = 'knowledge.db';

/**
 * Single explicit DB location: $OPENCODE_KNOWLEDGE_DB wins when set,
 * otherwise <package-root>/knowledge.db next to this package.
 * No silent candidate chain — a wrong path must fail loudly, never attach elsewhere.
 */
export function resolveKnowledgeDbPath(requested?: string): string {
  if (requested) return requested;
  const fromEnv = process.env.OPENCODE_KNOWLEDGE_DB;
  if (fromEnv) return fromEnv;
  return join(dirname(import.meta.dir), KNOWLEDGE_DB_FILENAME);
}

export class LocalVectorDB {
  private db: Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = resolveKnowledgeDbPath(dbPath);
    this.db = new Database(this.dbPath);
    this.init();
  }

  private init(): void {
    // Enable WAL mode for high concurrent read/write speed
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA synchronous = NORMAL;');
    // Pilot finding: parallel handles on one knowledge file fail fast with
    // SQLITE_BUSY. Wait instead; CLI invocations stay short-lived and sequential.
    this.db.run('PRAGMA busy_timeout = 5000;');

    // 1. Chunks table with vector BLOB storage
    this.db.run(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        stage INTEGER NOT NULL,
        section TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        tags TEXT NOT NULL,
        language TEXT NOT NULL,
        source TEXT NOT NULL,
        difficulty INTEGER NOT NULL,
        vector BLOB NOT NULL
      );
    `);

    // 2. FTS5 Virtual Table for fast BM25 keyword search
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        id UNINDEXED,
        title,
        section,
        content,
        tags
      );
    `);

    // Create helpful indices
    this.db.run('CREATE INDEX IF NOT EXISTS idx_chunks_stage ON chunks(stage);');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(type);');
  }

  public upsertChunk(chunk: KnowledgeChunk, vector: Float32Array): void {
    const insertChunk = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (id, title, stage, section, content, type, tags, language, source, difficulty, vector)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFts = this.db.prepare(`
      INSERT OR REPLACE INTO chunks_fts (id, title, section, content, tags)
      VALUES (?, ?, ?, ?, ?)
    `);

    const tagsStr = chunk.metadata.tags.join(', ');
    const vectorBuffer = Buffer.from(vector.buffer);

    this.db.transaction(() => {
      insertChunk.run(
        chunk.id,
        chunk.title,
        chunk.stage,
        chunk.section,
        chunk.content,
        chunk.metadata.type,
        tagsStr,
        chunk.metadata.language,
        chunk.metadata.source,
        chunk.metadata.difficulty,
        vectorBuffer
      );

      // Clean old FTS row if exists
      this.db.run('DELETE FROM chunks_fts WHERE id = ?', [chunk.id]);
      insertFts.run(
        chunk.id,
        chunk.title,
        chunk.section,
        chunk.content,
        tagsStr
      );
    })();
  }

  public upsertBatch(chunks: KnowledgeChunk[], vectors: Float32Array[]): void {
    const insertChunk = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (id, title, stage, section, content, type, tags, language, source, difficulty, vector)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFts = this.db.prepare(`
      INSERT OR REPLACE INTO chunks_fts (id, title, section, content, tags)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const vec = vectors[i];
        const tagsStr = chunk.metadata.tags.join(', ');
        const vectorBuffer = Buffer.from(vec.buffer);

        insertChunk.run(
          chunk.id,
          chunk.title,
          chunk.stage,
          chunk.section,
          chunk.content,
          chunk.metadata.type,
          tagsStr,
          chunk.metadata.language,
          chunk.metadata.source,
          chunk.metadata.difficulty,
          vectorBuffer
        );

        this.db.run('DELETE FROM chunks_fts WHERE id = ?', [chunk.id]);
        insertFts.run(
          chunk.id,
          chunk.title,
          chunk.section,
          chunk.content,
          tagsStr
        );
      }
    })();
  }

  /**
   * Delete one chunk (row + FTS) by id. Used by the admission pipeline to
   * retire superseded knowledge from active retrieval. Returns true when a
   * chunk existed. Staging audit records are untouched (different database).
   */
  public deleteChunk(id: string): boolean {
    const existing = this.db.query(`SELECT id FROM chunks WHERE id = ?`).get(id) as { id: string } | null;
    if (!existing) return false;
    this.db.transaction(() => {
      this.db.run('DELETE FROM chunks_fts WHERE id = ?', [id]);
      this.db.run('DELETE FROM chunks WHERE id = ?', [id]);
    })();
    return true;
  }

  /**
   * Count chunks whose source starts with a prefix (e.g. 'candidate:').
   * Read-only. Used to separate governed admissions from the raw corpus
   * without touching any other behavior.
   */
  public countBySourcePrefix(prefix: string): number {
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const row = this.db.query(
      `SELECT COUNT(*) AS count FROM chunks WHERE source LIKE ? ESCAPE '\\'`
    ).get(`${esc(prefix)}%`) as { count: number } | null;
    return row ? row.count : 0;
  }

  /**
   * Full rebuild helper: drop every indexed row (chunks + FTS).
   * Makes default-corpus indexing orphan-free by construction.
   */
  public clear(): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM chunks_fts');
      this.db.run('DELETE FROM chunks');
    })();
  }

  /**
   * Delete every row whose source is basePath or lives under it.
   * Makes re-indexing one tree idempotent and removes its orphans
   * (deleted files) without touching other indexed trees.
   */
  public deleteTree(basePath: string): void {
    const prefix = basePath.endsWith('/') ? basePath : `${basePath}/`;
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const rows = this.db.query(
      `SELECT id FROM chunks WHERE source = ? OR source LIKE ? ESCAPE '\\'`
    ).all(basePath, `${esc(prefix)}%`) as Array<{ id: string }>;
    if (rows.length === 0) return;
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    this.db.transaction(() => {
      this.db.run(`DELETE FROM chunks_fts WHERE id IN (${placeholders})`, ids);
      this.db.run(`DELETE FROM chunks WHERE id IN (${placeholders})`, ids);
    })();
  }

  /**
   * Fast Vector Cosine Similarity Search
   */
  public vectorSearch(queryVector: Float32Array, topK: number = 10, minScore: number = 0.3): RetrievalResult[] {
    const rows = this.db.query(`SELECT * FROM chunks`).all() as any[];
    const scored: Array<{ row: any; similarity: number }> = [];

    for (const row of rows) {
      const rowVec = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4);
      const sim = LocalEmbedder.cosineSimilarity(queryVector, rowVec);
      if (sim >= minScore) {
        scored.push({ row, similarity: sim });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    const topResults = scored.slice(0, topK);

    return topResults.map((item, idx) => ({
      rank: idx + 1,
      id: item.row.id,
      title: item.row.title,
      section: item.row.section,
      content: item.row.content,
      similarity: Number(item.similarity.toFixed(4)),
      stage: item.row.stage,
      type: item.row.type,
      tags: item.row.tags ? item.row.tags.split(',').map((t: string) => t.trim()) : [],
      source: item.row.source,
    }));
  }

  /**
   * Native FTS5 BM25 Full-Text Search
   */
  public textSearch(queryText: string, topK: number = 10): RetrievalResult[] {
    const cleanQuery = queryText.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
    if (!cleanQuery) return [];

    const ftsQuery = cleanQuery.split(/\s+/).filter(w => w.length > 1).map(w => `"${w}"*`).join(' OR ');
    if (!ftsQuery) return [];

    try {
      const rows = this.db.query(`
        SELECT c.*, bm25(chunks_fts) as rank_score
        FROM chunks_fts f
        JOIN chunks c ON c.id = f.id
        WHERE chunks_fts MATCH ?
        ORDER BY rank_score ASC
        LIMIT ?
      `).all(ftsQuery, topK) as any[];

      return rows.map((row, idx) => {
        // BM25 is negative lower-is-better in sqlite, convert to normalized 0-1 scale
        const sim = Math.max(0.1, Math.min(1.0, 1.0 / (1.0 + Math.abs(row.rank_score || 0) * 0.1)));
        return {
          rank: idx + 1,
          id: row.id,
          title: row.title,
          section: row.section,
          content: row.content,
          similarity: Number(sim.toFixed(4)),
          stage: row.stage,
          type: row.type,
          tags: row.tags ? row.tags.split(',').map((t: string) => t.trim()) : [],
          source: row.source,
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Hybrid Search: Combines Dense Vector + Sparse BM25
   */
  public hybridSearch(
    queryText: string,
    queryVector: Float32Array,
    options: SearchOptions = {}
  ): RetrievalResult[] {
    const topK = options.topK || 5;
    const minScore = options.minSimilarity || 0.3;

    const vecResults = this.vectorSearch(queryVector, topK * 2, 0.1);
    const txtResults = this.textSearch(queryText, topK * 2);

    const merged = new Map<string, { result: RetrievalResult; finalScore: number }>();

    // Weight: 0.65 Vector + 0.35 Text
    for (const vr of vecResults) {
      merged.set(vr.id, {
        result: vr,
        finalScore: vr.similarity * 0.65,
      });
    }

    for (const tr of txtResults) {
      if (merged.has(tr.id)) {
        const item = merged.get(tr.id)!;
        item.finalScore += tr.similarity * 0.35;
      } else {
        merged.set(tr.id, {
          result: tr,
          finalScore: tr.similarity * 0.35,
        });
      }
    }

    let list = Array.from(merged.values())
      .map(item => {
        item.result.similarity = Number(item.finalScore.toFixed(4));
        return item.result;
      })
      .filter(r => r.similarity >= minScore);

    // Filter by options if provided
    if (options.stage !== undefined) {
      list = list.filter(r => r.stage === options.stage);
    }
    if (options.type !== undefined) {
      list = list.filter(r => r.type === options.type);
    }
    if (options.tags && options.tags.length > 0) {
      list = list.filter(r => options.tags!.some(t => r.tags.includes(t)));
    }

    list.sort((a, b) => b.similarity - a.similarity);
    const top = list.slice(0, topK).map((r, idx) => ({ ...r, rank: idx + 1 }));
    // B5 abstention gate (HARDENING-02): no substantive lexical overlap
    // between query and results means no project knowledge applies — return
    // an honest empty list from inside the engine, never display hiding.
    return applyAbstentionGate(queryText, top);
  }

  public getStats(): IndexStats {
    const totalRow = this.db.query('SELECT COUNT(*) as cnt FROM chunks').get() as any;
    const totalChunks = totalRow ? totalRow.cnt : 0;

    const stagesRows = this.db.query('SELECT stage, COUNT(*) as cnt FROM chunks GROUP BY stage').all() as any[];
    const stagesCount: Record<number, number> = {};
    for (const sr of stagesRows) {
      stagesCount[sr.stage] = sr.cnt;
    }

    const typesRows = this.db.query('SELECT type, COUNT(*) as cnt FROM chunks GROUP BY type').all() as any[];
    const typesCount: Record<string, number> = {};
    for (const tr of typesRows) {
      typesCount[tr.type] = tr.cnt;
    }

    let dbSizeBytes = 0;
    if (existsSync(this.dbPath)) {
      dbSizeBytes = statSync(this.dbPath).size;
    }

    return {
      totalChunks,
      totalSections: totalChunks,
      dbSizeBytes,
      stagesCount,
      typesCount,
    };
  }

  public close(): void {
    this.db.close();
  }
}

export default new LocalVectorDB();
