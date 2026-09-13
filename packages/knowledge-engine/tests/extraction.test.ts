import { describe, expect, test } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { extractCandidates } from '../src/extraction';
import { toChunk } from '../src/candidate';
import { CandidateStore } from '../src/staging';

const GENERALIZABLE_A = 'SessionRunner initializes epoch before promotion';
const GENERALIZABLE_B = 'Provider turn allowance resets once per steer batch';

describe('Candidate extraction (B2)', () => {
  test('accepts timeless architectural statements', () => {
    const found = extractCandidates(
      `## Session Architecture\n- ${GENERALIZABLE_A}\n- ${GENERALIZABLE_B}`,
      'ses_abc123',
    );
    expect(found.map((c) => c.content)).toEqual([GENERALIZABLE_A, GENERALIZABLE_B]);
    expect(found.every((c) => c.sourceSession === 'ses_abc123')).toBe(true);
  });

  test('Gate 1+2: drops session-specific and episodic units', () => {
    const found = extractCandidates(
      ['Fixed issue in session abc', 'User asked to retry', GENERALIZABLE_A].join('\n- '),
      'ses_abc123',
    );
    expect(found.map((c) => c.content)).toEqual([GENERALIZABLE_A]);
  });

  test('Gate 1+2: drops first-person past actions and temporal deictics', () => {
    const found = extractCandidates(
      ['I tried restarting the runner just now', 'We decided to retry the migration', GENERALIZABLE_B].join(
        '\n- ',
      ),
      'ses_abc123',
    );
    expect(found.map((c) => c.content)).toEqual([GENERALIZABLE_B]);
  });

  test('Gate 3: drops credentials, tokens, emails, keys', () => {
    const found = extractCandidates(
      [
        'Deploy with password: s3cr3t-hunter2 value set',
        'Use token sk-abcdefgh12345678 for the API',
        'Contact admin@example.com for access',
        'AKIAIOSFODNN7EXAMPLE is the access key',
        GENERALIZABLE_A,
      ].join('\n- '),
      'ses_abc123',
    );
    expect(found.map((c) => c.content)).toEqual([GENERALIZABLE_A]);
  });

  test('Gate 3: drops home paths but keeps project-relative paths', () => {
    const dropped = extractCandidates('- Config was read from /home/alice/.opencode/config', 'ses_1');
    expect(dropped).toEqual([]);
    const kept = extractCandidates(
      '- Project references live under packages/docs relative to the repo root',
      'ses_1',
    );
    expect(kept).toHaveLength(1);
  });

  test('drops thin fragments and empty input', () => {
    expect(extractCandidates('- ok\n- fix it', 'ses_1')).toEqual([]);
    expect(extractCandidates('', 'ses_1')).toEqual([]);
    expect(extractCandidates('   ', 'ses_1')).toEqual([]);
    expect(extractCandidates(GENERALIZABLE_A, '')).toEqual([]);
    expect(extractCandidates(GENERALIZABLE_A, '  ')).toEqual([]);
  });

  test('is deterministic and deduplicates repeated units', () => {
    const summary = `## Findings\n- ${GENERALIZABLE_A}\n- ${GENERALIZABLE_A}\n- ${GENERALIZABLE_B}`;
    const first = extractCandidates(summary, 'ses_1');
    const second = extractCandidates(summary, 'ses_1');
    expect(second).toEqual(first);
    expect(first).toHaveLength(2);
  });

  test('caps output to protect staging from floods', () => {
    const bullets = Array.from({ length: 30 }, (_, i) => `Architecture rule number ${i} about component behavior`).join(
      '\n- ',
    );
    expect(extractCandidates(bullets, 'ses_1')).toHaveLength(10);
    expect(extractCandidates(bullets, 'ses_1', { maxCandidates: 3 })).toHaveLength(3);
  });

  test('classifies troubleshooting and practice units', () => {
    const found = extractCandidates(
      '- Fixed by clearing the stale cache directory when the build crashes\n- Always prefer explicit error returns over thrown exceptions',
      'ses_1',
    );
    expect(found.map((c) => c.type)).toEqual(['troubleshooting', 'practice']);
  });

  test('B2 stop boundary: extract → stage (pending) — staged is not indexable', () => {
    const path = `/tmp/test_extract_stage_${Date.now()}_${Math.floor(Math.random() * 1e9)}.db`;
    const store = new CandidateStore(path);
    try {
      const inputs = extractCandidates(`## Findings\n- ${GENERALIZABLE_A}\n- ${GENERALIZABLE_B}`, 'ses_stage1');
      expect(inputs.length).toBeGreaterThan(0);
      for (const candidateInput of inputs) store.create(candidateInput);
      const staged = store.list();
      expect(staged).toHaveLength(inputs.length);
      expect(staged.every((c) => c.status === 'pending')).toBe(true);
      // Nothing here can reach knowledge.db: approval has not happened.
      for (const candidate of staged) expect(() => toChunk(candidate)).toThrow(/must be approved/);
    } finally {
      store.close();
      for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) {
        try {
          if (existsSync(file)) unlinkSync(file);
        } catch {
          // best-effort cleanup
        }
      }
    }
  });
});
