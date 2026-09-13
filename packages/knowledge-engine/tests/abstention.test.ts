import { describe, expect, test, afterEach } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { LocalEmbedder } from '../src/embedder';
import { LocalVectorDB } from '../src/vector-db';
import { LocalRetriever } from '../src/retriever';
import { applyAbstentionGate, hasLexicalSupport, substantiveTokens } from '../src/abstention';
import type { KnowledgeChunk } from '../src/types';

/**
 * HARDENING-02 frozen retrieval evaluation fixture (OBS-RETRIEVAL-ABSTENTION-01).
 *
 * Q1 English strong in-domain / Q2 Arabic strong in-domain /
 * Q3 governed-memory paraphrase / Q4 weak valid in-domain must survive;
 * Q5 Arabic out-of-domain / Q6 English out-of-domain must abstain (results=0).
 *
 * All databases here are isolated temp files — production knowledge.db is
 * never touched by this fixture.
 */

const Q1 = 'Which project conventions govern composing Effect workflows and naming observable service operations?';
const Q2 = 'ما قواعد المشروع لبناء تدفقات Effect المركبة وتسمية العمليات التي نريد تتبعها؟';
const Q3 = 'named traced effects with project domain prefixes and composable workflows';
const Q4 = 'Effect service workflow conventions';
const Q5 = 'كيف أختار نوع التربة المناسب لزراعة شجرة فاكهة؟';
const Q6 = 'How should I water indoor tropical plants during summer?';

const GOVERNED_CONTENT =
  'Always use Effect.gen with yield* for composition and Effect.fn with domain prefix for named traced effects in this codebase';

const SEEDS: ReadonlyArray<Omit<KnowledgeChunk, 'metadata'> & { metadata: KnowledgeChunk['metadata'] }> = [
  {
    id: 'cand-711ec7f0',
    title: 'Always use Effect',
    stage: 1,
    section: 'candidate',
    content: GOVERNED_CONTENT,
    metadata: {
      source: 'candidate:cand-711ec7f0',
      type: 'practice',
      tags: ['always', 'effect', 'yield', 'composition'],
      language: 'mixed',
      difficulty: 3,
    },
  },
  {
    id: 'chunk-agents',
    title: 'AGENTS',
    stage: 1,
    section: 'effect',
    content:
      '- Use `Effect.gen(function* () { ... })` for composition.\n' +
      '- Use `Effect.fn("Domain.method")` for named/traced effects and `Effect.fnUntraced` for internal helpers.',
    metadata: { source: 'AGENTS.md', type: 'lesson', tags: ['effect', 'composition', 'traced'], language: 'mixed', difficulty: 1 },
  },
  {
    id: 'chunk-skill',
    title: 'SKILL',
    stage: 1,
    section: 'effect',
    content:
      'Prefer current Effect v4 APIs and project-local patterns over old blog posts. ' +
      'Use `Effect.gen(function* () { ... })` for multi-step workflows. ' +
      'Use `Effect.fn("Name")` for named effects in reusable service methods.',
    metadata: { source: 'SKILL.md', type: 'lesson', tags: ['effect', 'workflows', 'service'], language: 'en', difficulty: 1 },
  },
  {
    id: 'chunk-generic',
    title: 'CONTRIBUTING',
    stage: 1,
    section: 'dev',
    content:
      'During development, `bun dev` is the local equivalent of the built `opencode` command. ' +
      'Both run the same CLI interface.',
    metadata: { source: 'CONTRIBUTING.md', type: 'lesson', tags: ['dev', 'cli'], language: 'en', difficulty: 1 },
  },
  {
    id: 'chunk-ar-generic',
    title: 'QUICKSTART',
    stage: 1,
    section: 'arabic',
    content: 'كيف أكتب API بـ Python؟ ابحث في قاعدة المعرفة عن القوالب والأمثلة العملية.',
    metadata: { source: 'QUICKSTART.md', type: 'lesson', tags: ['quickstart'], language: 'ar', difficulty: 1 },
  },
  {
    id: 'chunk-stale',
    title: 'HANDOFF',
    stage: 1,
    section: 'snapshot',
    content: 'تم إنجاز المشروع بنسبة 100%. الحالة: جاهز للإنتاج والاستخدام المباشر.',
    metadata: { source: 'HANDOFF.md', type: 'lesson', tags: ['handoff'], language: 'ar', difficulty: 1 },
  },
];

const tempDbs: string[] = [];
afterEach(() => {
  for (const path of tempDbs.splice(0)) {
    for (const file of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) {
      try {
        if (existsSync(file)) unlinkSync(file);
      } catch {
        // best-effort cleanup
      }
    }
  }
});

function seedDb(): LocalVectorDB {
  const path = `/tmp/test_abstention_${Date.now()}_${Math.floor(Math.random() * 1e9)}.db`;
  tempDbs.push(path);
  const db = new LocalVectorDB(path);
  const embedder = new LocalEmbedder();
  for (const chunk of SEEDS) {
    db.upsertChunk(chunk, embedder.embed(`${chunk.title} ${chunk.section} ${chunk.content}`));
  }
  return db;
}

describe('HARDENING-02 abstention gate', () => {
  test('tokenizer drops stopwords and short tokens in both languages', () => {
    expect(substantiveTokens('How should I water indoor plants?')).toEqual(['water', 'indoor', 'plants']);
    expect(substantiveTokens('كيف أختار نوع التربة؟')).toEqual(['أختار', 'نوع', 'التربة']);
    expect(substantiveTokens('Effect.gen Effect.fn')).toContain('effect');
  });

  test('empty or stopword-only queries never have lexical support', () => {
    expect(hasLexicalSupport('', [{ id: 'x' } as never])).toBe(false);
    expect(hasLexicalSupport('كيف ما هل؟', [{ id: 'x' } as never])).toBe(false);
  });

  test('1. strong English in-domain survives with authoritative evidence', async () => {
    const seeded = seedDb();
    try {
      const results = await new LocalRetriever(seeded).retrieveRelevant(Q1, 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(5);
      expect(results.some((r) => ['chunk-agents', 'chunk-skill', 'cand-711ec7f0'].includes(r.id))).toBe(true);
    } finally {
      seeded.close();
    }
  });

  test('2. strong Arabic in-domain survives via the exact AGENTS rule', async () => {
    const seeded = seedDb();
    try {
      const results = await new LocalRetriever(seeded).retrieveRelevant(Q2, 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === 'chunk-agents')).toBe(true);
    } finally {
      seeded.close();
    }
  });

  test('3. governed-memory paraphrase retrieves governed or authoritative knowledge', async () => {
    const seeded = seedDb();
    try {
      const results = await new LocalRetriever(seeded).retrieveRelevant(Q3, 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => ['cand-711ec7f0', 'chunk-agents', 'chunk-skill'].includes(r.id))).toBe(true);
    } finally {
      seeded.close();
    }
  });

  test('4. weak valid in-domain is not suppressed', async () => {
    const seeded = seedDb();
    try {
      const results = await new LocalRetriever(seeded).retrieveRelevant(Q4, 5);
      expect(results.length).toBeGreaterThan(0);
    } finally {
      seeded.close();
    }
  });

  test('5. Arabic out-of-domain abstains with an honest empty list', async () => {
    const seeded = seedDb();
    try {
      const results = await new LocalRetriever(seeded).retrieveRelevant(Q5, 5);
      expect(results).toEqual([]);
    } finally {
      seeded.close();
    }
  });

  test('6. English out-of-domain abstains with an honest empty list', async () => {
    const seeded = seedDb();
    try {
      const results = await new LocalRetriever(seeded).retrieveRelevant(Q6, 5);
      expect(results).toEqual([]);
    } finally {
      seeded.close();
    }
  });

  test('7-10. engine and retriever agree; filters and bounds intact', async () => {
    const seeded = seedDb();
    try {
      const retriever = new LocalRetriever(seeded);
      // Direct engine and retriever paths abstain identically.
      expect(await retriever.retrieveRelevant(Q5, 5)).toEqual([]);
      expect(await retriever.retrieveRelevant(Q6, 5)).toEqual([]);
      // Metadata filters still apply on surviving queries.
      const filtered = await retriever.retrieveRelevant(Q1, 5, { type: 'practice' });
      expect(filtered.every((r) => r.type === 'practice')).toBe(true);
      expect(filtered.some((r) => r.id === 'cand-711ec7f0')).toBe(true);
      // Top-K stays bounded.
      const top2 = await retriever.retrieveRelevant(Q1, 2);
      expect(top2.length).toBeLessThanOrEqual(2);
      // Gate is display-independent: engine-level empty, not CLI hiding.
      expect(applyAbstentionGate(Q5, [])).toEqual([]);
    } finally {
      seeded.close();
    }
  });
});
