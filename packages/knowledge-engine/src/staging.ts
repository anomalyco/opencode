import { Database } from 'bun:sqlite';
import { join, dirname } from 'path';
import {
  approveCandidate,
  createCandidate,
  rejectCandidate,
  supersedeCandidate,
  type Candidate,
  type CandidateInput,
  type CandidateStatus,
} from './candidate';

/**
 * B1 — Staging store for Phase 4B (Engineering Memory System).
 *
 * Candidates live HERE, in their own database, until review. This store
 * never touches knowledge.db: the only path from a Candidate to an
 * indexable chunk is B0's `toChunk`, which refuses non-approved candidates.
 *
 * State transitions delegate to the B0 pure functions, so the lifecycle
 * (pending → approved | rejected, approved → superseded) has exactly one
 * definition. This store only persists it.
 */

export const CANDIDATES_DB_FILENAME = 'knowledge-candidates.db';

/**
 * Single explicit DB location: explicit arg wins, then
 * $OPENCODE_KNOWLEDGE_CANDIDATES_DB, otherwise <package-root>/knowledge-candidates.db.
 * Deliberately separate from knowledge.db — staging and production never share a file.
 */
export function resolveCandidatesDbPath(requested?: string): string {
  if (requested) return requested;
  const fromEnv = process.env.OPENCODE_KNOWLEDGE_CANDIDATES_DB;
  if (fromEnv) return fromEnv;
  return join(dirname(import.meta.dir), CANDIDATES_DB_FILENAME);
}

interface CandidateRow {
  id: string;
  title: string;
  summary: string;
  content: string;
  type: string;
  tags: string;
  language: string;
  difficulty: number;
  provenance_source_session: string;
  provenance_extractor: string;
  provenance_summary_ref: string | null;
  created_at: number;
  updated_at: number;
  status: string;
  review_note: string | null;
  superseded_by: string | null;
}

function toRow(candidate: Candidate): CandidateRow {
  return {
    id: candidate.id,
    title: candidate.title,
    summary: candidate.summary,
    content: candidate.content,
    type: candidate.type,
    tags: JSON.stringify(candidate.tags),
    language: candidate.language,
    difficulty: candidate.difficulty,
    provenance_source_session: candidate.provenance.sourceSession,
    provenance_extractor: candidate.provenance.extractor,
    provenance_summary_ref: candidate.provenance.summaryRef ?? null,
    created_at: candidate.createdAt,
    updated_at: candidate.updatedAt,
    status: candidate.status,
    review_note: candidate.reviewNote ?? null,
    superseded_by: candidate.supersededBy ?? null,
  };
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function fromRow(row: CandidateRow): Candidate {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    content: row.content,
    type: row.type as Candidate['type'],
    tags: parseTags(row.tags),
    language: row.language,
    difficulty: row.difficulty,
    provenance: {
      sourceSession: row.provenance_source_session,
      extractor: row.provenance_extractor,
      ...(row.provenance_summary_ref === null ? {} : { summaryRef: row.provenance_summary_ref }),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status as CandidateStatus,
    ...(row.review_note === null ? {} : { reviewNote: row.review_note }),
    ...(row.superseded_by === null ? {} : { supersededBy: row.superseded_by }),
  };
}

export interface CandidateListFilter {
  status?: CandidateStatus | ReadonlyArray<CandidateStatus>;
}

export class CandidateStore {
  private db: Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = resolveCandidatesDbPath(dbPath);
    this.db = new Database(this.dbPath);
    this.init();
  }

  public path(): string {
    return this.dbPath;
  }

  private init(): void {
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA synchronous = NORMAL;');
    // Pilot finding: parallel handles on one staging file fail fast with
    // SQLITE_BUSY. Wait instead; CLI invocations stay short-lived and sequential.
    this.db.run('PRAGMA busy_timeout = 5000;');
    this.db.run(`
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        tags TEXT NOT NULL,
        language TEXT NOT NULL,
        difficulty INTEGER NOT NULL,
        provenance_source_session TEXT NOT NULL,
        provenance_extractor TEXT NOT NULL,
        provenance_summary_ref TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        review_note TEXT,
        superseded_by TEXT
      );
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);');
  }

  /** Build (B0 semantics) and persist. Re-saving the same deterministic id replaces. */
  public create(input: CandidateInput, now?: number): Candidate {
    const candidate = createCandidate(input, now);
    this.save(candidate);
    return candidate;
  }

  /** Upsert by deterministic id: re-extraction of the same knowledge updates in place (rowid preserved). */
  public save(candidate: Candidate): void {
    const row = toRow(candidate);
    this.db.prepare(`
      INSERT INTO candidates
        (id, title, summary, content, type, tags, language, difficulty,
         provenance_source_session, provenance_extractor, provenance_summary_ref,
         created_at, updated_at, status, review_note, superseded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        content = excluded.content,
        type = excluded.type,
        tags = excluded.tags,
        language = excluded.language,
        difficulty = excluded.difficulty,
        provenance_source_session = excluded.provenance_source_session,
        provenance_extractor = excluded.provenance_extractor,
        provenance_summary_ref = excluded.provenance_summary_ref,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        status = excluded.status,
        review_note = excluded.review_note,
        superseded_by = excluded.superseded_by
    `).run(
      row.id, row.title, row.summary, row.content, row.type, row.tags, row.language, row.difficulty,
      row.provenance_source_session, row.provenance_extractor, row.provenance_summary_ref,
      row.created_at, row.updated_at, row.status, row.review_note, row.superseded_by,
    );
  }

  public get(id: string): Candidate | undefined {
    const row = this.db.query(`SELECT * FROM candidates WHERE id = ?`).get(id) as CandidateRow | null;
    return row === null ? undefined : fromRow(row);
  }

  public list(filter: CandidateListFilter = {}): Candidate[] {
    const statuses = filter.status === undefined ? [] : Array.isArray(filter.status) ? [...filter.status] : [filter.status];
    const rows = (statuses.length === 0
      ? this.db.query(`SELECT * FROM candidates ORDER BY rowid ASC`).all()
      : this.db.query(
          `SELECT * FROM candidates WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY rowid ASC`
        ).all(...statuses)) as CandidateRow[];
    return rows.map(fromRow);
  }

  public remove(id: string): boolean {
    const result = this.db.query(`DELETE FROM candidates WHERE id = ?`).run(id);
    return Number(result.changes ?? 0) > 0;
  }

  private transition(id: string, apply: (current: Candidate) => Candidate): Candidate {
    const current = this.get(id);
    if (!current) throw new Error(`Candidate not found: ${id}`);
    const next = apply(current);
    this.save(next);
    return next;
  }

  /** pending → approved (B0 rules enforced), persisted. */
  public approve(id: string, note = '', now?: number): Candidate {
    return this.transition(id, (current) => approveCandidate(current, note, now));
  }

  /** pending → rejected with a required reason (B0 rules enforced), persisted. */
  public reject(id: string, note: string, now?: number): Candidate {
    return this.transition(id, (current) => rejectCandidate(current, note, now));
  }

  /** approved → superseded (B0 rules enforced), persisted. */
  public supersede(id: string, byId: string, now?: number): Candidate {
    return this.transition(id, (current) => supersedeCandidate(current, byId, now));
  }

  public close(): void {
    this.db.close();
  }
}
