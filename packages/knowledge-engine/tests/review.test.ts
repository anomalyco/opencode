import { describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { toChunk } from '../src/candidate';
import { extractCandidates } from '../src/extraction';
import { decide, pendingReviews, reviewCandidate } from '../src/review';
import { CandidateStore } from '../src/staging';

function tempDb(): string {
  return `/tmp/test_review_${Date.now()}_${Math.floor(Math.random() * 1e9)}.db`;
}

function cleanup(path: string): void {
  for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) {
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch {
      // best-effort cleanup
    }
  }
}

const input = {
  title: 'SessionRunner initializes epoch before promotion',
  summary: 'Session fixed admission-vs-execution ordering in the runner.',
  content: 'SessionRunner initializes the context epoch before promoting steers; promotion happens after.',
  sourceSession: 'ses_review1',
};

describe('Human review gate (B3)', () => {
  test('pendingReviews is the inbox: pending only, with validation precomputed', () => {
    const path = tempDb();
    const store = new CandidateStore(path);
    try {
      const good = store.create(input);
      const thin = store.create({ ...input, title: 'Thin', content: '  ' });
      const approved = store.create({ ...input, title: 'Old', content: 'old approved content here' });
      store.approve(approved.id, 'verified earlier');

      const inbox = pendingReviews(store);
      expect(inbox.map((view) => view.candidate.id).sort()).toEqual([good.id, thin.id].sort());
      expect(inbox).toHaveLength(2);
      const valid = inbox.find((view) => view.candidate.id === good.id)!;
      expect(valid.reviewable).toBe(true);
      expect(valid.problems).toEqual([]);
      expect(valid.canApprove).toBe(true);
      const invalid = inbox.find((view) => view.candidate.id !== good.id)!;
      expect(invalid.problems).toContain('content must not be empty');
      expect(invalid.canApprove).toBe(false);
    } finally {
      store.close();
      cleanup(path);
    }
  });

  test('reviewCandidate prepares one candidate and throws when missing', () => {
    const path = tempDb();
    const store = new CandidateStore(path);
    try {
      const created = store.create(input);
      const view = reviewCandidate(store, created.id);
      expect(view.candidate).toEqual(created);
      expect(view.reviewable).toBe(true);
      expect(() => reviewCandidate(store, 'cand-missing')).toThrow(/not found/);
    } finally {
      store.close();
      cleanup(path);
    }
  });

  test('decide approve records the note and never rewrites the knowledge', () => {
    const path = tempDb();
    const store = new CandidateStore(path);
    try {
      const created = store.create(input);
      const approved = decide(store, created.id, { action: 'approve', note: 'verified against runner tests' });
      expect(approved.status).toBe('approved');
      expect(approved.reviewNote).toBe('verified against runner tests');
      expect(approved.title).toBe(created.title);
      expect(approved.content).toBe(created.content);
      expect(approved.provenance).toEqual(created.provenance);
      expect(pendingReviews(store)).toHaveLength(0);
    } finally {
      store.close();
      cleanup(path);
    }
  });

  test('decide approve refuses invalid candidates', () => {
    const path = tempDb();
    const store = new CandidateStore(path);
    try {
      const thin = store.create({ ...input, content: '  ' });
      expect(() => decide(store, thin.id, { action: 'approve' })).toThrow(/invalid candidate/);
      expect(store.get(thin.id)?.status).toBe('pending');
    } finally {
      store.close();
      cleanup(path);
    }
  });

  test('decide reject requires a reason', () => {
    const path = tempDb();
    const store = new CandidateStore(path);
    try {
      const created = store.create(input);
      const rejected = decide(store, created.id, { action: 'reject', reason: 'session-specific, not generalizable' });
      expect(rejected.status).toBe('rejected');
      const other = store.create({ ...input, title: 'Other', content: 'other reviewable content' });
      expect(() => decide(store, other.id, { action: 'reject', reason: '   ' })).toThrow(/requires a reason/);
    } finally {
      store.close();
      cleanup(path);
    }
  });

  test('decide supersede needs an existing approved replacement', () => {
    const path = tempDb();
    const store = new CandidateStore(path);
    try {
      const old = store.create({ ...input, title: 'Old rule', content: 'old rule content superseded' });
      const replacement = store.create({ ...input, title: 'New rule', content: 'new rule content replacing' });
      expect(() => decide(store, old.id, { action: 'supersede', byId: replacement.id })).toThrow(/must be approved/);
      expect(() => decide(store, old.id, { action: 'supersede', byId: 'cand-missing' })).toThrow(/not found/);
      expect(() => decide(store, old.id, { action: 'supersede', byId: old.id })).toThrow(/itself/);
      decide(store, old.id, { action: 'approve', note: 'incumbent rule' });
      decide(store, replacement.id, { action: 'approve', note: 'better version' });
      const superseded = decide(store, old.id, { action: 'supersede', byId: replacement.id });
      expect(superseded.status).toBe('superseded');
      expect(superseded.supersededBy).toBe(replacement.id);
    } finally {
      store.close();
      cleanup(path);
    }
  });

  test('decide rejects unknown actions', () => {
    const path = tempDb();
    const store = new CandidateStore(path);
    try {
      const created = store.create(input);
      expect(() => decide(store, created.id, { action: 'archive' } as never)).toThrow(/Unknown review action/);
    } finally {
      store.close();
      cleanup(path);
    }
  });

  test('full B3 flow: extract → stage → review → approve/reject; B3 ends at approved', () => {
    const path = tempDb();
    const store = new CandidateStore(path);
    try {
      const inputs = extractCandidates(
        '## Findings\n- SessionRunner initializes epoch before promotion\n- User asked to retry\n- Provider turn allowance resets once per steer batch',
        'ses_flow1',
      );
      expect(inputs.length).toBe(2);
      for (const candidateInput of inputs) store.create(candidateInput);

      expect(pendingReviews(store)).toHaveLength(2);
      const [first, second] = pendingReviews(store).map((view) => view.candidate);
      decide(store, first.id, { action: 'approve', note: 'verified pattern' });
      decide(store, second.id, { action: 'reject', reason: 'duplicate of existing lesson' });

      expect(pendingReviews(store)).toHaveLength(0);
      expect(store.list({ status: 'approved' })).toHaveLength(1);
      expect(store.list({ status: 'rejected' })).toHaveLength(1);

      // B3's output boundary: only the approved candidate is indexable (B4 input).
      // No knowledge.db write happens anywhere in this flow.
      const approved = store.list({ status: 'approved' })[0];
      expect(toChunk(approved).id).toBe(approved.id);
      for (const candidate of store.list({ status: 'rejected' })) {
        expect(() => toChunk(candidate)).toThrow(/must be approved/);
      }
    } finally {
      store.close();
      cleanup(path);
    }
  });
});
