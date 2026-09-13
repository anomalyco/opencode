import { describe, expect, test } from 'bun:test';
import {
  approveCandidate,
  candidateId,
  createCandidate,
  isReviewable,
  rejectCandidate,
  supersedeCandidate,
  toChunk,
  validateCandidate,
  type Candidate,
} from '../src/candidate';

const input = {
  title: 'Retry budget resets once per batch of steers',
  summary: 'Session fixed a runner bug where every steer reset the turn allowance.',
  content: 'Promoting any new user input resets the selected agent provider-turn allowance; a batch of steers resets it once.',
  sourceSession: 'ses_abc123',
};

function pending(): Candidate {
  return createCandidate(input, 1000);
}

describe('Candidate model (B0)', () => {
  test('candidateId is deterministic per (session, title, content)', () => {
    expect(candidateId('s', 't', 'c')).toBe(candidateId('s', 't', 'c'));
    expect(candidateId('s', 't', 'c')).not.toBe(candidateId('s', 't', 'other'));
    expect(candidateId('s', 't', 'c')).not.toBe(candidateId('other', 't', 'c'));
    expect(candidateId('s', 't', 'c')).toMatch(/^cand-[0-9a-f]{8}$/);
  });

  test('createCandidate starts pending with defaults and matching id', () => {
    const c = pending();
    expect(c.status).toBe('pending');
    expect(c.id).toBe(candidateId(input.sourceSession, input.title, input.content));
    expect(c.type).toBe('lesson');
    expect(c.tags).toEqual([]);
    expect(c.createdAt).toBe(1000);
    expect(c.updatedAt).toBe(1000);
    expect(validateCandidate(c)).toEqual([]);
  });

  test('approve moves pending → approved and records the note', () => {
    const c = approveCandidate(pending(), 'verified against runner tests', 2000);
    expect(c.status).toBe('approved');
    expect(c.reviewNote).toBe('verified against runner tests');
    expect(c.updatedAt).toBe(2000);
    expect(isReviewable(c)).toBe(false);
  });

  test('approve throws for non-pending and for invalid candidates', () => {
    const approved = approveCandidate(pending(), 'ok');
    expect(() => approveCandidate(approved)).toThrow();
    expect(() => rejectCandidate(approved, 'too late')).toThrow();
    const empty = createCandidate({ ...input, content: '  ' });
    expect(validateCandidate(empty)).toContain('content must not be empty');
    expect(() => approveCandidate(empty)).toThrow(/invalid candidate/);
  });

  test('reject moves pending → rejected and requires a reason', () => {
    const c = rejectCandidate(pending(), 'session-specific, not generalizable', 2000);
    expect(c.status).toBe('rejected');
    expect(c.reviewNote).toBe('session-specific, not generalizable');
    expect(() => rejectCandidate(pending(), '   ')).toThrow(/requires a reason/);
  });

  test('supersede moves approved → superseded and records the replacement', () => {
    const approved = approveCandidate(pending(), 'ok');
    const c = supersedeCandidate(approved, 'cand-00000001', 3000);
    expect(c.status).toBe('superseded');
    expect(c.supersededBy).toBe('cand-00000001');
    expect(() => supersedeCandidate(pending(), 'cand-00000001')).toThrow();
    expect(() => supersedeCandidate(approved, '  ')).toThrow(/replacing id/);
  });

  test('validate flags malformed candidates without throwing', () => {
    const bad: Candidate = { ...pending(), title: ' ', status: 'superseded' };
    expect(validateCandidate(bad)).toContain('title must not be empty');
    expect(validateCandidate(bad)).toContain('superseded candidates must record supersededBy');
    const stray: Candidate = { ...pending(), supersededBy: 'cand-x' };
    expect(validateCandidate(stray)).toContain('only superseded candidates may record supersededBy');
  });

  test('toChunk converts approved candidates and refuses everything else', () => {
    const chunk = toChunk(approveCandidate(pending(), 'ok'));
    expect(chunk.id).toBe(pending().id);
    expect(chunk.title).toBe(input.title);
    expect(chunk.content).toBe(input.content);
    expect(chunk.metadata.source).toBe(`candidate:${pending().id}`);
    expect(chunk.metadata.type).toBe('lesson');
    expect(() => toChunk(pending())).toThrow(/must be approved/);
    expect(() => toChunk(rejectCandidate(pending(), 'no'))).toThrow(/must be approved/);
  });
});
