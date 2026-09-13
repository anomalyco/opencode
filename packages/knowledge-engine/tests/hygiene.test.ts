import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, unlinkSync, symlinkSync } from 'fs';
import { join } from 'path';
import { LocalVectorDB, resolveKnowledgeDbPath } from '../src/vector-db';
import { KnowledgeExtractor, chunkId, normalizeBase } from '../src/extractor';
import { KnowledgeEngineManager } from '../src/manager';

function tmpDir(prefix: string): string {
  const dir = join('/tmp', `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Phase 2 — Index Hygiene', () => {
  test('resolveKnowledgeDbPath is explicit: requested > env > package default, no silent chain', () => {
    expect(resolveKnowledgeDbPath('/x/y.db')).toBe('/x/y.db');

    const prev = process.env.OPENCODE_KNOWLEDGE_DB;
    process.env.OPENCODE_KNOWLEDGE_DB = '/tmp/explicit-nowhere.db';
    expect(resolveKnowledgeDbPath()).toBe('/tmp/explicit-nowhere.db');
    if (prev === undefined) delete process.env.OPENCODE_KNOWLEDGE_DB;
    else process.env.OPENCODE_KNOWLEDGE_DB = prev;

    const def = resolveKnowledgeDbPath();
    expect(def.endsWith('/packages/knowledge-engine/knowledge.db')).toBe(true);
  });

  test('chunkId is deterministic and unique per (source, section, occurrence)', () => {
    expect(chunkId('/a/b.md', 'Intro', 0)).toBe(chunkId('/a/b.md', 'Intro', 0));
    expect(chunkId('/a/b.md', 'Intro', 0)).not.toBe(chunkId('/a/b.md', 'Intro', 1));
    expect(chunkId('/a/b.md', 'Intro', 0)).not.toBe(chunkId('/a/c.md', 'Intro', 0));
    expect(chunkId('/a/b.md', 'Intro', 0)).toMatch(/^chunk-[0-9a-f]{8}$/);
  });

  test('normalizeBase resolves symlinks so one tree has one identity', () => {
    const dir = tmpDir('hygiene-norm');
    const link = join('/tmp', `hygiene-link_${Date.now()}`);
    writeFileSync(join(dir, 'a.md'), '# T\nbody\n');
    try {
      symlinkSync(dir, link);
      expect(normalizeBase(link)).toBe(normalizeBase(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(link, { recursive: true, force: true });
    }
  });

  test('extractAll yields stable ids across runs and unique ids for repeated headings', () => {
    const dir = tmpDir('hygiene-ids');
    writeFileSync(join(dir, 'doc.md'), '# One\nfirst body\n## Dup\nx\n## Dup\ny\n');
    try {
      const ex = new KnowledgeExtractor();
      const first = ex.extractAll(dir).map(c => c.id);
      const second = new KnowledgeExtractor().extractAll(dir).map(c => c.id);
      expect(first.length).toBe(3);
      expect(first).toEqual(second);
      expect(new Set(first).size).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('deleteTree removes one tree only; clear removes everything', () => {
    const db = new LocalVectorDB(join('/tmp', `hygiene_tree_${Date.now()}.db`));
    const mk = (id: string, source: string) => ({
      id,
      title: 't',
      stage: 1,
      section: 's',
      content: `content ${id}`,
      metadata: { source, type: 'lesson' as const, tags: [] as string[], language: 'en', difficulty: 10 },
    });
    const vec = new Float32Array(384).fill(0.1);
    db.upsertBatch([mk('a1', '/tmp/treeA/f.md'), mk('b1', '/tmp/treeB/f.md')], [vec, vec]);

    db.deleteTree('/tmp/treeA');
    expect(db.getStats().totalChunks).toBe(1);

    db.deleteTree('/tmp/treeB/');
    expect(db.getStats().totalChunks).toBe(0);

    db.upsertBatch([mk('c1', '/tmp/treeC/f.md')], [vec]);
    db.clear();
    expect(db.getStats().totalChunks).toBe(0);
    db.close();
  });

  test('manager.buildIndex is idempotent and drops orphans of deleted files', () => {
    const dir = tmpDir('hygiene-manager');
    const dbPath = join('/tmp', `hygiene_mgr_${Date.now()}.db`);
    const manager = new KnowledgeEngineManager(dbPath);
    writeFileSync(join(dir, 'one.md'), '# Alpha\nbody alpha\n');
    writeFileSync(join(dir, 'two.md'), '# Beta\nbody beta\n');
    try {
      const first = manager.buildIndex(dir);
      const second = manager.buildIndex(dir);
      expect(second.count).toBe(first.count);
      expect(second.stats.totalChunks).toBe(first.stats.totalChunks);

      unlinkSync(join(dir, 'two.md'));
      const third = manager.buildIndex(dir);
      expect(third.stats.totalChunks).toBeLessThan(second.stats.totalChunks);
      expect(third.stats.totalChunks).toBe(first.stats.totalChunks - 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(dbPath, { force: true });
    }
  });
});
