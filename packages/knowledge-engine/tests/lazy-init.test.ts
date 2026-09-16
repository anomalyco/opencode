import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

/**
 * Lazy knowledge initialization (KNOWLEDGE_DB_LAZY_INITIALIZATION).
 *
 * Importing the engine — the exact chain behind `opencode --version` and
 * `opencode session list`, which statically reach the package barrel —
 * must neither open nor create any database. Only explicit construction
 * (e.g. the `search` command) may initialize storage on demand.
 */
describe('Knowledge lazy initialization', () => {
  test('importing the barrel creates no database files', async () => {
    const xdg = join('/tmp', `lazy-xdg_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
    mkdirSync(xdg, { recursive: true });
    const prevXdg = process.env.XDG_DATA_HOME;
    const prevK = process.env.OPENCODE_KNOWLEDGE_DB;
    const prevC = process.env.OPENCODE_KNOWLEDGE_CANDIDATES_DB;
    process.env.XDG_DATA_HOME = xdg;
    delete process.env.OPENCODE_KNOWLEDGE_DB;
    delete process.env.OPENCODE_KNOWLEDGE_CANDIDATES_DB;
    try {
      await import('../src/index.ts');
      expect(existsSync(join(xdg, 'opencode', 'knowledge.db'))).toBe(false);
      expect(existsSync(join(xdg, 'opencode', 'knowledge-candidates.db'))).toBe(false);
      expect(existsSync(join(xdg, 'opencode'))).toBe(false);
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = prevXdg;
      if (prevK !== undefined) process.env.OPENCODE_KNOWLEDGE_DB = prevK;
      if (prevC !== undefined) process.env.OPENCODE_KNOWLEDGE_CANDIDATES_DB = prevC;
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  test('explicit construction still initializes storage on demand', async () => {
    const xdg = join('/tmp', `lazy-demand_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
    mkdirSync(xdg, { recursive: true });
    const prevXdg = process.env.XDG_DATA_HOME;
    const prevK = process.env.OPENCODE_KNOWLEDGE_DB;
    process.env.XDG_DATA_HOME = xdg;
    delete process.env.OPENCODE_KNOWLEDGE_DB;
    try {
      const { LocalVectorDB } = await import('../src/vector-db.ts');
      // Source runs keep the next-to-package default: nothing may appear under XDG.
      expect(existsSync(join(xdg, 'opencode'))).toBe(false);
      const dbPath = join(xdg, 'opencode', 'knowledge.db');
      const db = new LocalVectorDB(dbPath);
      expect(existsSync(dbPath)).toBe(true);
      db.close();
    } finally {
      if (prevXdg === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = prevXdg;
      if (prevK !== undefined) process.env.OPENCODE_KNOWLEDGE_DB = prevK;
      rmSync(xdg, { recursive: true, force: true });
    }
  });
});
