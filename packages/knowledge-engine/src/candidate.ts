import { hashId } from './extractor';
import type { KnowledgeChunk } from './types';

/**
 * B0 — Candidate data model for Phase 4B (Engineering Memory System).
 *
 * A Candidate is proposed knowledge distilled from a session (later: from its
 * compaction summary). It lives in a STAGING store, never in knowledge.db,
 * until a review decision approves it.
 *
 * Data only: no database, no I/O, no writes anywhere. The forbidden path
 * (Session → knowledge.db directly) is made unrepresentable: `toChunk`
 * refuses every candidate whose status is not `approved`.
 */

export type CandidateStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

export type CandidateKind = 'lesson' | 'prompt' | 'practice' | 'troubleshooting';

export interface CandidateProvenance {
  /** Session the knowledge was distilled from. */
  sourceSession: string;
  /** Pipeline that produced the candidate (e.g. 'compaction-summary/v1'). */
  extractor: string;
  /** Reference to the source summary (compaction/event id) when known. */
  summaryRef?: string;
}

export interface Candidate {
  /** Deterministic: same (session, title, content) → same id, so re-extraction replaces instead of duplicating. */
  id: string;
  title: string;
  /** Source summary excerpt — review context, not indexed text. */
  summary: string;
  /** The extracted, generalizable knowledge text — what would be indexed after approval. */
  content: string;
  type: CandidateKind;
  tags: string[];
  language: string;
  difficulty: number;
  provenance: CandidateProvenance;
  createdAt: number;
  updatedAt: number;
  status: CandidateStatus;
  /** Reviewer note recorded at approve/reject time. */
  reviewNote?: string;
  /** Approving/superseding candidate id that replaced this one. Set only when superseded. */
  supersededBy?: string;
}

export interface CandidateInput {
  title: string;
  summary: string;
  content: string;
  sourceSession: string;
  type?: CandidateKind;
  tags?: string[];
  language?: string;
  difficulty?: number;
  extractor?: string;
  summaryRef?: string;
}

export function candidateId(sourceSession: string, title: string, content: string): string {
  return `cand-${hashId(`${sourceSession}\n${title}\n${content}`)}`;
}

/** Total constructor: fills defaults, always starts as `pending`. Problems are reported by `validateCandidate`, not thrown here. */
export function createCandidate(input: CandidateInput, now: number = Date.now()): Candidate {
  return {
    id: candidateId(input.sourceSession, input.title, input.content),
    title: input.title,
    summary: input.summary,
    content: input.content,
    type: input.type ?? 'lesson',
    tags: input.tags ?? [],
    language: input.language ?? 'mixed',
    difficulty: input.difficulty ?? 3,
    provenance: {
      sourceSession: input.sourceSession,
      extractor: input.extractor ?? 'manual/v1',
      ...(input.summaryRef === undefined ? {} : { summaryRef: input.summaryRef }),
    },
    createdAt: now,
    updatedAt: now,
    status: 'pending',
  };
}

const KNOWN_STATUSES: ReadonlyArray<CandidateStatus> = ['pending', 'approved', 'rejected', 'superseded'];

/** Pure validation. Returns a list of problems; empty means the candidate is well-formed. */
export function validateCandidate(candidate: Candidate): string[] {
  const problems: string[] = [];
  if (!KNOWN_STATUSES.includes(candidate.status)) problems.push(`unknown status: ${candidate.status}`);
  if (candidate.title.trim().length === 0) problems.push('title must not be empty');
  if (candidate.content.trim().length === 0) problems.push('content must not be empty');
  if (candidate.summary.trim().length === 0) problems.push('summary must not be empty');
  if (candidate.provenance.sourceSession.trim().length === 0) problems.push('provenance.sourceSession must not be empty');
  if (candidate.updatedAt < candidate.createdAt) problems.push('updatedAt must not precede createdAt');
  if (candidate.status === 'superseded' && (candidate.supersededBy ?? '').trim().length === 0) {
    problems.push('superseded candidates must record supersededBy');
  }
  if (candidate.status !== 'superseded' && candidate.supersededBy !== undefined) {
    problems.push('only superseded candidates may record supersededBy');
  }
  return problems;
}

export function isReviewable(candidate: Candidate): boolean {
  return candidate.status === 'pending';
}

function mustBeValid(candidate: Candidate, action: string): void {
  const problems = validateCandidate(candidate);
  if (problems.length > 0) throw new Error(`Cannot ${action} invalid candidate ${candidate.id}: ${problems.join('; ')}`);
}

/** pending → approved. Records the reviewer note. Invalid or non-pending candidates throw. */
export function approveCandidate(candidate: Candidate, note = '', now: number = Date.now()): Candidate {
  if (candidate.status !== 'pending') throw new Error(`Cannot approve candidate ${candidate.id} with status ${candidate.status}`);
  mustBeValid(candidate, 'approve');
  return { ...candidate, status: 'approved', updatedAt: now, ...(note.length === 0 ? {} : { reviewNote: note }) };
}

/** pending → rejected. Rejection always records a reason. */
export function rejectCandidate(candidate: Candidate, note: string, now: number = Date.now()): Candidate {
  if (candidate.status !== 'pending') throw new Error(`Cannot reject candidate ${candidate.id} with status ${candidate.status}`);
  if (note.trim().length === 0) throw new Error(`Rejecting candidate ${candidate.id} requires a reason`);
  return { ...candidate, status: 'rejected', updatedAt: now, reviewNote: note };
}

/** approved → superseded. Only approved knowledge can be superseded; pending proposals are rejected instead. */
export function supersedeCandidate(candidate: Candidate, byId: string, now: number = Date.now()): Candidate {
  if (candidate.status !== 'approved') {
    throw new Error(`Cannot supersede candidate ${candidate.id} with status ${candidate.status}`);
  }
  if (byId.trim().length === 0) throw new Error(`Superseding candidate ${candidate.id} requires the replacing id`);
  return { ...candidate, status: 'superseded', updatedAt: now, supersededBy: byId };
}

/**
 * The B4 gate in miniature: converts an APPROVED candidate into an indexable
 * chunk. Every other status throws — there is no code path from a session
 * to knowledge.db that bypasses approval.
 */
export function toChunk(candidate: Candidate): KnowledgeChunk {
  if (candidate.status !== 'approved') {
    throw new Error(`Candidate ${candidate.id} must be approved before indexing (status: ${candidate.status})`);
  }
  mustBeValid(candidate, 'index');
  return {
    id: candidate.id,
    title: candidate.title,
    stage: 1,
    section: 'candidate',
    content: candidate.content,
    metadata: {
      source: `candidate:${candidate.id}`,
      type: candidate.type,
      tags: candidate.tags,
      language: candidate.language,
      difficulty: candidate.difficulty,
    },
  };
}
