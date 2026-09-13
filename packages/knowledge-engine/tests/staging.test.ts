import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { KNOWLEDGE_DB_FILENAME } from '../src/vector-db';
import {
  CANDIDATES_DB_FILENAME,
  CandidateStore,
  resolveCandidatesDbPath,
} from '../src/staging';

const paths: string[] = [];
function tempDb(): string {
  const path = `/tmp/test_candidates_${Date.now()}_${Math.floor(Math.random() * 1e9)}.db`;
  paths.push(path);
  return path;
}
afterAll(() => {
  for (const path of paths) {
    for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) {
      try {
        if (existsSync(file)) unlinkSync(file);
      } catch {
        // best-effort cleanup
      }
    }
  }
});

const input = {
  title: 'Retry budget resets once per batch of steers',
  summary: 'Session fixed a runner bug where every steer reset the turn allowance.',
  content: 'Promoting any new user input resets the provider-turn allowance; a batch of steers resets it once.',
  sourceSession: 'ses_abc123',
};

describe('CandidateStore staging (B1)', () => {
  test('staging lives in its own file, never knowledge.db', () => {
    expect(CANDIDATES_DB_FILENAME).toBe('knowledge-candidates.db');
    expect(CANDIDATES_DB_FILENAME).not.toBe(KNOWLEDGE_DB_FILENAME);
    expect(resolveCandidatesDbPath('/x/y.db')).toBe('/x/y.db');
    expect(resolveCandidatesDbPath()).toContain('knowledge-candidates.db');
  });

  test('create → get round-trips every field', () => {
    const store = new CandidateStore(tempDb());
    try {
      const created = store.create({ ...input, tags: ['runner,steers', 'epoch'] });
      const loaded = store.get(created.id);
      expect(loaded).toEqual(created);
      expect(loaded?.tags).toEqual(['runner,steers', 'epoch']);
      expect(loaded?.status).toBe('pending');
      expect(store.get('cand-doesnotexist')).toBeUndefined();
    } finally {
      store.close();
    }
  });

  test('saving the same deterministic id replaces instead of duplicating', () => {
    const store = new CandidateStore(tempDb());
    try {
      const first = store.create(input);
      const second = store.create({ ...input, summary: 're-extracted with better summary' });
      expect(second.id).toBe(first.id);
      expect(store.list()).toHaveLength(1);
      expect(store.get(first.id)?.summary).toBe('re-extracted with better summary');
    } finally {
      store.close();
    }
  });

  test('list filters by status in creation order', () => {
    const store = new CandidateStore(tempDb());
    try {
      const a = store.create({ ...input, title: 'First', content: 'first content' });
      const b = store.create({ ...input, title: 'Second', content: 'second content' });
      store.approve(a.id, 'verified');
      expect(store.list().map((c) => c.id)).toEqual([a.id, b.id]);
      expect(store.list({ status: 'pending' }).map((c) => c.id)).toEqual([b.id]);
      expect(store.list({ status: 'approved' }).map((c) => c.id)).toEqual([a.id]);
      expect(store.list({ status: ['pending', 'approved'] })).toHaveLength(2);
      expect(store.list({ status: 'rejected' })).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test('remove deletes and reports existence', () => {
    const store = new CandidateStore(tempDb());
    try {
      const created = store.create(input);
      expect(store.remove(created.id)).toBe(true);
      expect(store.get(created.id)).toBeUndefined();
      expect(store.remove(created.id)).toBe(false);
    } finally {
      store.close();
    }
  });

  test('transitions persist B0 semantics and reject invalid moves', () => {
    const store = new CandidateStore(tempDb());
    try {
      const created = store.create(input);
      const approved = store.approve(created.id, 'verified against runner tests');
      expect(approved.status).toBe('approved');
      expect(store.get(created.id)?.status).toBe('approved');
      expect(() => store.approve(created.id)).toThrow();
      expect(() => store.reject(created.id, 'too late')).toThrow();
      const superseded = store.supersede(created.id, 'cand-00000001');
      expect(superseded.status).toBe('superseded');
      expect(store.get(created.id)?.supersededBy).toBe('cand-00000001');

      const pending = store.create({ ...input, title: 'Other', content: 'other content' });
      expect(() => store.supersede(pending.id, 'cand-00000002')).toThrow();
      const rejected = store.reject(pending.id, 'session-specific, not generalizable');
      expect(store.get(pending.id)?.status).toBe('rejected');
      expect(rejected.reviewNote).toBe('session-specific, not generalizable');
      expect(() => store.reject(pending.id, 'again')).toThrow();
      expect(() => store.approve('cand-missing', 'x')).toThrow(/not found/);
    } finally {
      store.close();
    }
  });

  test('DoD: persist → close → reload → transition survives restarts', () => {
    const path = tempDb();
    const first = new CandidateStore(path);
    let id: string;
    try {
      id = first.create(input).id;
    } finally {
      first.close();
    }
    const second = new CandidateStore(path);
    try {
      expect(second.get(id)?.status).toBe('pending');
      second.approve(id, 'verified after restart');
    } finally {
      second.close();
    }
    const third = new CandidateStore(path);
    try {
      const reloaded = third.get(id);
      expect(reloaded?.status).toBe('approved');
      expect(reloaded?.reviewNote).toBe('verified after restart');
    } finally {
      third.close();
    }
  });
});
