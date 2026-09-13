import {
  isReviewable,
  validateCandidate,
  type Candidate,
} from './candidate';
import { CandidateStore } from './staging';

/**
 * B3 — Human review gate for Phase 4B (Engineering Memory System).
 *
 * This is the workflow spine between staging and approval:
 *
 *   store.list(status = pending) → review(candidate) → decide(id, one of three)
 *
 * It reads and writes ONLY the staging store and reuses the B0 state
 * machine plus `validateCandidate` — no new lifecycle, no knowledge.db,
 * no indexing. B3 ends at `status = approved`; admission into knowledge.db
 * is B4's job (via B0's `toChunk`, which already refuses the rest).
 */

export interface ReviewView {
  candidate: Candidate;
  /** Well-formedness problems (B0 validation). Non-empty means "fix or reject". */
  problems: string[];
  /** True only while pending. */
  reviewable: boolean;
  /** True only when reviewable AND well-formed. */
  canApprove: boolean;
}

export function toReviewView(candidate: Candidate): ReviewView {
  const problems = validateCandidate(candidate);
  const reviewable = isReviewable(candidate);
  return { candidate, problems, reviewable, canApprove: reviewable && problems.length === 0 };
}

/** The review inbox: every pending candidate with its validation precomputed. */
export function pendingReviews(store: CandidateStore): ReviewView[] {
  return store.list({ status: 'pending' }).map(toReviewView);
}

/** A single candidate prepared for a human decision. Throws when missing. */
export function reviewCandidate(store: CandidateStore, id: string): ReviewView {
  const candidate = store.get(id);
  if (!candidate) throw new Error(`Candidate not found: ${id}`);
  return toReviewView(candidate);
}

export type ReviewDecision =
  | { readonly action: 'approve'; readonly note?: string }
  | { readonly action: 'reject'; readonly reason: string }
  | { readonly action: 'supersede'; readonly byId: string };

/**
 * Apply exactly one of the three review outcomes. Status rules stay defined
 * in B0 (via the store); B3 adds one workflow policy: a supersede target
 * must already exist AND be approved, so provenance never dangles and
 * replacement ordering stays explicit (approve the replacement first).
 */
export function decide(store: CandidateStore, id: string, decision: ReviewDecision): Candidate {
  switch (decision.action) {
    case 'approve':
      return store.approve(id, decision.note ?? '');
    case 'reject':
      return store.reject(id, decision.reason);
    case 'supersede': {
      if (decision.byId === id) throw new Error(`Candidate ${id} cannot supersede itself`);
      const target = store.get(decision.byId);
      if (!target) throw new Error(`Supersede target not found: ${decision.byId}`);
      if (target.status !== 'approved') {
        throw new Error(`Supersede target ${decision.byId} must be approved (status: ${target.status})`);
      }
      return store.supersede(id, decision.byId);
    }
    default:
      throw new Error(`Unknown review action: ${(decision as ReviewDecision).action}`);
  }
}
