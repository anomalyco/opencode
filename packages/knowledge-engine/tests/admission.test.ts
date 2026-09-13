import { describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { admit, admitCandidate } from '../src/admission';
import { LocalEmbedder } from '../src/embedder';
import { decide } from '../src/review';
import { extractCandidates } from '../src/extraction';
import { LocalRetriever } from '../src/retriever';
import { CandidateStore } from '../src/staging';
import { LocalVectorDB } from '../src/vector-db';

function tempDb(prefix: string): string {
  return `/tmp/test_${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}.db`;
}

function cleanup(...paths: string[]): void {
  for (const path of paths) {
    for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) {
      try {
        if (existsSync(file)) unlinkSync(file);
      } catch {
        // best-effort cleanup
      }
    }
  }
}

function openStaging(path: string): CandidateStore {
  return new CandidateStore(path);
}

function openKnowledge(path: string): LocalVectorDB {
  return new LocalVectorDB(path);
}

class FailingEmbedder extends LocalEmbedder {
  override embed(): Float32Array {
    throw new Error('embedder down');
  }
}

class FailingRetriever extends LocalRetriever {
  override async retrieveRelevant(): Promise<never> {
    throw new Error('retriever down');
  }
}

const EPOCH = {
  title: 'SessionRunner initializes epoch before promotion',
  summary: 'Session fixed admission-vs-execution ordering in the runner.',
  content: 'SessionRunner initializes the context epoch before promoting steers in the runner lifecycle.',
  sourceSession: 'ses_admit1',
};

const ALLOWANCE = {
  title: 'Provider turn allowance resets once per batch',
  summary: 'Session fixed repeated resets of the provider-turn allowance.',
  content: 'Provider turn allowance resets once per steer batch in the session coordinator.',
  sourceSession: 'ses_admit2',
};

describe('Approved admission pipeline (B4)', () => {
  test('approved admission: toChunk → index → retrievable, staging untouched', async () => {
    const stagingPath = tempDb('staging');
    const knowledgePath = tempDb('knowledge');
    const store = openStaging(stagingPath);
    const knowledge = openKnowledge(knowledgePath);
    try {
      const created = store.create(EPOCH);
      const approved = store.approve(created.id, 'verified pattern');
      const before = store.get(created.id);

      const { receipt, swept } = await admit({ store, knowledge }, created.id);

      expect(receipt.candidateId).toBe(created.id);
      expect(receipt.chunkId).toBe(created.id);
      expect(receipt.status).toBe('admitted');
      expect(receipt.verifiedRank).toBeGreaterThanOrEqual(0);
      expect(swept).toEqual([]);
      expect(knowledge.getStats().totalChunks).toBe(1);
      // Admission is read-only toward staging.
      expect(store.get(created.id)).toEqual({ ...approved, updatedAt: before!.updatedAt });
      expect(store.get(created.id)).toEqual(before);
    } finally {
      store.close();
      knowledge.close();
      cleanup(stagingPath, knowledgePath);
    }
  });

  test('pending refusal: nothing staged-for-review reaches the index', async () => {
    const stagingPath = tempDb('staging');
    const knowledgePath = tempDb('knowledge');
    const store = openStaging(stagingPath);
    const knowledge = openKnowledge(knowledgePath);
    try {
      const created = store.create(EPOCH);
      await expect(admit({ store, knowledge }, created.id)).rejects.toThrow(/must be approved/);
      expect(knowledge.getStats().totalChunks).toBe(0);
    } finally {
      store.close();
      knowledge.close();
      cleanup(stagingPath, knowledgePath);
    }
  });

  test('rejected refusal: rejected knowledge stays out of the index', async () => {
    const stagingPath = tempDb('staging');
    const knowledgePath = tempDb('knowledge');
    const store = openStaging(stagingPath);
    const knowledge = openKnowledge(knowledgePath);
    try {
      const created = store.create(EPOCH);
      store.reject(created.id, 'session-specific, not generalizable');
      await expect(admit({ store, knowledge }, created.id)).rejects.toThrow(/must be approved/);
      expect(knowledge.getStats().totalChunks).toBe(0);
    } finally {
      store.close();
      knowledge.close();
      cleanup(stagingPath, knowledgePath);
    }
  });

  test('invalid records are refused even when staged', async () => {
    const stagingPath = tempDb('staging');
    const knowledgePath = tempDb('knowledge');
    const store = openStaging(stagingPath);
    const knowledge = openKnowledge(knowledgePath);
    try {
      const created = store.create(EPOCH);
      const approved = store.approve(created.id, 'verified');
      store.save({ ...approved, content: '  ' });
      await expect(admit({ store, knowledge }, created.id)).rejects.toThrow(/invalid candidate/);
      expect(knowledge.getStats().totalChunks).toBe(0);
    } finally {
      store.close();
      knowledge.close();
      cleanup(stagingPath, knowledgePath);
    }
  });

  test('superseded handling: old chunk leaves active retrieval, audit stays in staging', async () => {
    const stagingPath = tempDb('staging');
    const knowledgePath = tempDb('knowledge');
    const store = openStaging(stagingPath);
    const knowledge = openKnowledge(knowledgePath);
    try {
      const old = store.create(EPOCH);
      const replacement = store.create(ALLOWANCE);
      store.approve(old.id, 'incumbent rule');
      store.approve(replacement.id, 'better version');
      await admit({ store, knowledge }, old.id);
      await admit({ store, knowledge }, replacement.id);

      const epochQuery = EPOCH.content.slice(0, 200);
      expect((await new LocalRetriever(knowledge).retrieveRelevant(epochQuery, 5)).some((r) => r.id === old.id)).toBe(
        true,
      );

      store.supersede(old.id, replacement.id);
      const second = await admit({ store, knowledge }, replacement.id);
      expect(second.swept).toEqual([old.id]);

      const after = await new LocalRetriever(knowledge).retrieveRelevant(epochQuery, 5);
      expect(after.some((r) => r.id === old.id)).toBe(false);
      expect(knowledge.textSearch('epoch', 5).some((r) => r.id === old.id)).toBe(false);
      const allowanceQuery = ALLOWANCE.content.slice(0, 200);
      expect(
        (await new LocalRetriever(knowledge).retrieveRelevant(allowanceQuery, 5)).some((r) => r.id === replacement.id),
      ).toBe(true);
      // Audit intact in staging.
      const audit = store.get(old.id)!;
      expect(audit.status).toBe('superseded');
      expect(audit.supersededBy).toBe(replacement.id);
      expect(audit.content).toBe(EPOCH.content);
    } finally {
      store.close();
      knowledge.close();
      cleanup(stagingPath, knowledgePath);
    }
  });

  test('idempotency: admitting twice does not duplicate chunks', async () => {
    const stagingPath = tempDb('staging');
    const knowledgePath = tempDb('knowledge');
    const store = openStaging(stagingPath);
    const knowledge = openKnowledge(knowledgePath);
    try {
      const created = store.create(EPOCH);
      store.approve(created.id, 'verified');
      await admit({ store, knowledge }, created.id);
      const second = await admit({ store, knowledge }, created.id);
      expect(knowledge.getStats().totalChunks).toBe(1);
      expect(second.receipt.status).toBe('admitted');
    } finally {
      store.close();
      knowledge.close();
      cleanup(stagingPath, knowledgePath);
    }
  });

  test('database separation: staging is audit, knowledge is active', async () => {
    const stagingPath = tempDb('staging');
    const knowledgePath = tempDb('knowledge');
    expect(stagingPath).not.toBe(knowledgePath);
    const store = openStaging(stagingPath);
    const knowledge = openKnowledge(knowledgePath);
    try {
      const created = store.create(EPOCH);
      store.approve(created.id, 'verified');
      await admit({ store, knowledge }, created.id);
      expect(existsSync(stagingPath)).toBe(true);
      expect(existsSync(knowledgePath)).toBe(true);
      expect(store.get(created.id)?.status).toBe('approved');
      expect(knowledge.getStats().totalChunks).toBe(1);
    } finally {
      store.close();
      knowledge.close();
      cleanup(stagingPath, knowledgePath);
    }
  });

  test('restart durability: approve → close → reopen → admit → close → reopen → retrieve', async () => {
    const stagingPath = tempDb('staging');
    const knowledgePath = tempDb('knowledge');
    const first = openStaging(stagingPath);
    let id: string;
    try {
      id = first.create(EPOCH).id;
      first.approve(id, 'verified before restart');
    } finally {
      first.close();
    }
    const second = openStaging(stagingPath);
    const knowledge = openKnowledge(knowledgePath);
    try {
      expect(second.get(id)?.status).toBe('approved');
      await admit({ store: second, knowledge }, id);
    } finally {
      second.close();
      knowledge.close();
    }
    const third = openKnowledge(knowledgePath);
    try {
      const found = await new LocalRetriever(third).retrieveRelevant(EPOCH.content.slice(0, 200), 5);
      expect(found.some((r) => r.id === id)).toBe(true);
    } finally {
      third.close();
      cleanup(stagingPath, knowledgePath);
    }
  });

  test('atomic failure: embedder error means no claim and intact staging', async () => {
    const stagingPath = tempDb('staging');
    const knowledgePath = tempDb('knowledge');
    const store = openStaging(stagingPath);
    const knowledge = openKnowledge(knowledgePath);
    try {
      const created = store.create(EPOCH);
      store.approve(created.id, 'verified');
      const before = store.get(created.id);
      await expect(admit({ store, knowledge, embedder: new FailingEmbedder() }, created.id)).rejects.toThrow(
        /embedder down/,
      );
      expect(knowledge.getStats().totalChunks).toBe(0);
      expect(store.get(created.id)).toEqual(before);
    } finally {
      store.close();
      knowledge.close();
      cleanup(stagingPath, knowledgePath);
    }
  });

  test('V1.0.1 compensation: retriever failure after a successful write leaves nothing behind', async () => {
    const stagingPath = tempDb('staging');
    const knowledgePath = tempDb('knowledge');
    const store = openStaging(stagingPath);
    const knowledge = openKnowledge(knowledgePath);
    try {
      const created = store.create(EPOCH);
      store.approve(created.id, 'verified');
      const before = store.get(created.id);
      await expect(
        admit({ store, knowledge, retriever: new FailingRetriever(knowledge) }, created.id),
      ).rejects.toThrow(/retriever down/);
      // receipt = none (rejected above), chunk = absent, staging = intact.
      expect(knowledge.getStats().totalChunks).toBe(0);
      expect(knowledge.textSearch('epoch', 5)).toEqual([]);
      expect(store.get(created.id)).toEqual(before);
    } finally {
      store.close();
      knowledge.close();
      cleanup(stagingPath, knowledgePath);
    }
  });

  test('v1 end-to-end: summary → extract → stage → review → admit → new session retrieves it', async () => {
    const stagingPath = tempDb('staging');
    const knowledgePath = tempDb('knowledge');
    const summary = [
      '## Session Architecture',
      '- SessionRunner initializes the context epoch before promoting steers in the runner lifecycle',
      '- User asked to retry the flaky command',
      '## Provider Behavior',
      '- Provider turn allowance resets once per steer batch in the session coordinator',
    ].join('\n');

    const store = openStaging(stagingPath);
    const knowledge = openKnowledge(knowledgePath);
    try {
      // Extraction → staging (pending). The episodic unit is dropped by B2 gates.
      const inputs = extractCandidates(summary, 'ses_e2e1');
      expect(inputs.length).toBe(2);
      for (const candidateInput of inputs) store.create(candidateInput);
      expect(store.list({ status: 'pending' })).toHaveLength(2);

      // Human review.
      for (const view of store.list({ status: 'pending' })) {
        decide(store, view.id, { action: 'approve', note: 'e2e verified' });
      }
      expect(store.list({ status: 'approved' })).toHaveLength(2);

      // Admission.
      for (const approved of store.list({ status: 'approved' })) {
        const result = await admit({ store, knowledge }, approved.id);
        expect(result.receipt.status).toBe('admitted');
      }
      expect(knowledge.getStats().totalChunks).toBe(2);
    } finally {
      store.close();
      knowledge.close();
    }

    // A new session (fresh handles, same files) retrieves the approved knowledge.
    const freshKnowledge = openKnowledge(knowledgePath);
    try {
      const retriever = new LocalRetriever(freshKnowledge);
      const results = await retriever.retrieveRelevant('session runner epoch promotion admission order', 5, {
        minSimilarity: 0.1,
      });
      const contents = results.map((r) => r.content);
      expect(contents.some((c) => c.includes('initializes the context epoch'))).toBe(true);
    } finally {
      freshKnowledge.close();
      cleanup(stagingPath, knowledgePath);
    }
  });

  test('admitCandidate refuses unknown ids without touching the index', async () => {
    const stagingPath = tempDb('staging');
    const knowledgePath = tempDb('knowledge');
    const store = openStaging(stagingPath);
    const knowledge = openKnowledge(knowledgePath);
    try {
      await expect(admitCandidate({ store, knowledge }, 'cand-missing')).rejects.toThrow(/not found/);
      expect(knowledge.getStats().totalChunks).toBe(0);
    } finally {
      store.close();
      knowledge.close();
      cleanup(stagingPath, knowledgePath);
    }
  });
});
