import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { isPackagedDir, packagedDbPath, userDataDir } from '../src/paths';
import { KNOWLEDGE_DB_FILENAME, LocalVectorDB, resolveKnowledgeDbPath } from '../src/vector-db';
import { CANDIDATES_DB_FILENAME, CandidateStore, resolveCandidatesDbPath } from '../src/staging';

function tmpDir(prefix: string): string {
  const dir = join('/tmp', `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Packaged knowledge DB paths (KNOWLEDGE_DB_PACKAGED_PATH_FIX)', () => {
  test('isPackagedDir detects only Bun virtual-FS paths', () => {
    expect(isPackagedDir('/$bunfs/root/packages/knowledge-engine')).toBe(true);
    expect(isPackagedDir('/mnt/k/opencode/packages/knowledge-engine')).toBe(false);
    expect(isPackagedDir('/tmp/x.db')).toBe(false);
  });

  test('packaged default lives in the writable user-data dir, never under $bunfs', () => {
    const p = packagedDbPath(KNOWLEDGE_DB_FILENAME);
    expect(p.includes('$bunfs')).toBe(false);
    expect(p).toBe(join(userDataDir(), KNOWLEDGE_DB_FILENAME));
    expect(userDataDir()).toBe(join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'opencode'));
  });

  test('source-run default still resolves next to the package (dev unchanged)', () => {
    const prev = process.env.OPENCODE_KNOWLEDGE_DB;
    delete process.env.OPENCODE_KNOWLEDGE_DB;
    try {
      const def = resolveKnowledgeDbPath();
      expect(def.includes('$bunfs')).toBe(false);
      expect(def.endsWith('/packages/knowledge-engine/knowledge.db')).toBe(true);
    } finally {
      if (prev !== undefined) process.env.OPENCODE_KNOWLEDGE_DB = prev;
    }
  });

  test('explicit requested and env paths keep priority over every default', () => {
    expect(resolveKnowledgeDbPath('/x/y.db')).toBe('/x/y.db');
    expect(resolveCandidatesDbPath('/x/y.db')).toBe('/x/y.db');
    const prevK = process.env.OPENCODE_KNOWLEDGE_DB;
    const prevC = process.env.OPENCODE_KNOWLEDGE_CANDIDATES_DB;
    process.env.OPENCODE_KNOWLEDGE_DB = '/tmp/env-k.db';
    process.env.OPENCODE_KNOWLEDGE_CANDIDATES_DB = '/tmp/env-c.db';
    try {
      expect(resolveKnowledgeDbPath()).toBe('/tmp/env-k.db');
      expect(resolveCandidatesDbPath()).toBe('/tmp/env-c.db');
      expect(resolveKnowledgeDbPath('/x/y.db')).toBe('/x/y.db');
    } finally {
      if (prevK === undefined) delete process.env.OPENCODE_KNOWLEDGE_DB;
      else process.env.OPENCODE_KNOWLEDGE_DB = prevK;
      if (prevC === undefined) delete process.env.OPENCODE_KNOWLEDGE_CANDIDATES_DB;
      else process.env.OPENCODE_KNOWLEDGE_CANDIDATES_DB = prevC;
    }
  });

  test('constructors create a missing parent dir instead of SQLITE_CANTOPEN', () => {
    const dir = tmpDir('pkg-paths');
    try {
      const kPath = join(dir, 'nested', 'knowledge.db');
      const kdb = new LocalVectorDB(kPath);
      expect(existsSync(kPath)).toBe(true);
      kdb.close();

      const cPath = join(dir, 'nested', 'candidates.db');
      const cdb = new CandidateStore(cPath);
      expect(existsSync(cPath)).toBe(true);
      expect(cdb.path()).toBe(cPath);
      cdb.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('candidates default filename stays separate from knowledge.db', () => {
    expect(CANDIDATES_DB_FILENAME).not.toBe(KNOWLEDGE_DB_FILENAME);
    expect(packagedDbPath(CANDIDATES_DB_FILENAME)).not.toBe(packagedDbPath(KNOWLEDGE_DB_FILENAME));
  });
});
