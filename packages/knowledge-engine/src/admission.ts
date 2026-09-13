import { toChunk, validateCandidate } from './candidate';
import { LocalEmbedder } from './embedder';
import { LocalRetriever } from './retriever';
import { CandidateStore } from './staging';
import { LocalVectorDB } from './vector-db';

/**
 * B4 — Approved admission pipeline for Phase 4B (Engineering Memory System).
 *
 * The ONLY path from staging to knowledge.db:
 *
 *   load approved → revalidate → toChunk → embed → upsert → verify → receipt
 *
 * Entry requires `status === "approved"` (enforced by B0's `toChunk`;
 * pending / rejected / superseded are refused). Admission never writes to
 * staging — staging is read-only here; the persisted chunk plus the receipt
 * are the durable evidence. Every admission run also sweeps staged
 * superseded records out of active retrieval (audit records stay in
 * staging). Handles are explicit parameters: the module singletons are
 * never used, so tests run against isolated databases.
 */

export interface AdmissionDeps {
  readonly store: CandidateStore;
  readonly knowledge: LocalVectorDB;
  readonly embedder?: LocalEmbedder;
  readonly retriever?: LocalRetriever;
}

export interface AdmissionReceipt {
  readonly candidateId: string;
  readonly chunkId: string;
  readonly status: 'admitted';
  /** Rank of the chunk in the post-admission retrieval check (0-based). */
  readonly verifiedRank: number;
  readonly admittedAt: number;
}

export interface AdmissionResult {
  readonly receipt: AdmissionReceipt;
  /** Staged superseded ids whose chunks were retired from active retrieval. */
  readonly swept: string[];
}

function resolved(deps: AdmissionDeps): { embedder: LocalEmbedder; retriever: LocalRetriever } {
  const embedder = deps.embedder ?? new LocalEmbedder();
  const retriever = deps.retriever ?? new LocalRetriever(deps.knowledge, embedder);
  return { embedder, retriever };
}

/**
 * Admit one approved candidate: embed and upsert its chunk, then prove it
 * is persisted (vector self-match) and retrievable (hybrid search finds it).
 * Throws — with no receipt and no writes — on every failure: missing
 * record, non-approved status, invalid content, embedder or index errors.
 */
export async function admitCandidate(deps: AdmissionDeps, id: string): Promise<AdmissionReceipt> {
  const stored = deps.store.get(id);
  if (!stored) throw new Error(`Candidate not found: ${id}`);
  const problems = validateCandidate(stored);
  if (problems.length > 0) throw new Error(`Cannot admit invalid candidate ${id}: ${problems.join('; ')}`);
  // Gate: refuses pending / rejected / superseded by construction.
  const chunk = toChunk(stored);
  const { embedder, retriever } = resolved(deps);

  const vector = embedder.embed(chunk.content);
  deps.knowledge.upsertChunk(chunk, vector);
  try {
    const selfMatch = deps.knowledge.vectorSearch(vector, 5, 0);
    const persisted = selfMatch.some((row) => row.id === chunk.id && row.similarity >= 0.99);
    if (!persisted) throw new Error(`Admission verification failed: chunk ${chunk.id} not persisted`);

    const found = await retriever.retrieveRelevant(chunk.content.slice(0, 500), 5, { minSimilarity: 0.1 });
    const rank = found.findIndex((row) => row.id === chunk.id);
    if (rank < 0) throw new Error(`Admission verification failed: chunk ${chunk.id} not retrievable`);

    return { candidateId: id, chunkId: chunk.id, status: 'admitted', verifiedRank: rank, admittedAt: Date.now() };
  } catch (error) {
    // V1.0.1 compensation: a chunk written by this run must never survive an
    // unverified admission. Best-effort removal, then the original error —
    // compensation must not mask the admission failure.
    try {
      deps.knowledge.deleteChunk(chunk.id);
    } catch {
      // Intentionally silent: the admission error below is the signal.
    }
    throw error;
  }
}

/**
 * Retire superseded knowledge from ACTIVE retrieval. Staging audit records
 * are untouched — only chunks disappear. Runs on every admission so a
 * supersede decision takes effect even if no new candidate is admitted
 * afterwards, and so crash recovery converges on the next run.
 */
export function sweepSuperseded(deps: AdmissionDeps): string[] {
  const swept: string[] = [];
  for (const candidate of deps.store.list({ status: 'superseded' })) {
    if (deps.knowledge.deleteChunk(candidate.id)) swept.push(candidate.id);
  }
  return swept;
}

/** Full admission run: admit one candidate, then sweep retired knowledge. */
export async function admit(deps: AdmissionDeps, id: string): Promise<AdmissionResult> {
  const receipt = await admitCandidate(deps, id);
  const swept = sweepSuperseded(deps);
  return { receipt, swept };
}
