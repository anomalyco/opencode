import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'path';
import { CandidateStore } from '../src/staging';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const stagingModule = join(pkgDir, 'src', 'staging.ts');
const vectorDbModule = join(pkgDir, 'src', 'vector-db.ts');
const embedderModule = join(pkgDir, 'src', 'embedder.ts');

const paths: string[] = [];
function tempDb(prefix: string): string {
  const path = `/tmp/test_busy_${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}.db`;
  paths.push(path);
  return path;
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

/**
 * Pilot finding: two handles on one SQLite file failed fast with
 * SQLITE_BUSY. Both stores now set `PRAGMA busy_timeout = 5000`, so a
 * blocked writer waits instead. Proven here by holding a write lock in
 * this process while a separate process writes: without the pragma the
 * child dies instantly; with it, the child waits and succeeds.
 */
async function runWriter(script: string): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(['bun', '-e', script], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { code, stderr };
}

describe('SQLITE_BUSY behavior (pilot hardening)', () => {
  test('a blocked CandidateStore writer waits for the lock instead of failing fast', async () => {
    const path = tempDb('staging');
    const seed = new CandidateStore(path);
    const id = seed.create({
      title: 'Contention probe',
      summary: 'Probe summary for lock behavior.',
      content: 'Contention probe content for lock behavior testing.',
      sourceSession: 'ses_busy1',
    }).id;
    seed.close();

    const holder = new Database(path);
    holder.run('BEGIN IMMEDIATE');
    try {
      const child = runWriter(
        `const { CandidateStore } = await import(${JSON.stringify(stagingModule)});` +
          `const s = new CandidateStore(${JSON.stringify(path)});` +
          `s.approve(${JSON.stringify(id)}, 'contention proof');` +
          `s.close();`,
      );
      // Let the child boot, open, and reach its blocked write before releasing.
      await Bun.sleep(2500);
      holder.run('COMMIT');
      const { code, stderr } = await child;
      expect(`${code} ${stderr}`).not.toContain('SQLITE_BUSY');
      expect(code).toBe(0);
    } finally {
      try {
        holder.run('COMMIT');
      } catch {
        // already committed
      }
      holder.close();
    }

    const verify = new CandidateStore(path);
    try {
      expect(verify.get(id)?.status).toBe('approved');
    } finally {
      verify.close();
      cleanup(path);
    }
  }, 30000);

  test('a blocked LocalVectorDB writer waits for the lock instead of failing fast', async () => {
    const path = tempDb('knowledge');
    {
      // Create the schema first so the child only contends on the write.
      const { LocalVectorDB } = await import('../src/vector-db');
      const db = new LocalVectorDB(path);
      db.close();
    }

    const holder = new Database(path);
    holder.run('BEGIN IMMEDIATE');
    try {
      const child = runWriter(
        `const { LocalVectorDB } = await import(${JSON.stringify(vectorDbModule)});` +
          `const { LocalEmbedder } = await import(${JSON.stringify(embedderModule)});` +
          `const db = new LocalVectorDB(${JSON.stringify(path)});` +
          `const chunk = { id: 'chunk-busy1', title: 'Busy probe', stage: 1, section: 'probe', content: 'contention probe content', metadata: { source: 'probe', type: 'lesson', tags: [], language: 'mixed', difficulty: 1 } };` +
          `db.upsertChunk(chunk, new LocalEmbedder().embed(chunk.content));` +
          `db.close();`,
      );
      await Bun.sleep(2500);
      holder.run('COMMIT');
      const { code, stderr } = await child;
      expect(`${code} ${stderr}`).not.toContain('SQLITE_BUSY');
      expect(code).toBe(0);
    } finally {
      try {
        holder.run('COMMIT');
      } catch {
        // already committed
      }
      holder.close();
    }

    const { LocalVectorDB } = await import('../src/vector-db');
    const verify = new LocalVectorDB(path);
    try {
      expect(verify.getStats().totalChunks).toBe(1);
    } finally {
      verify.close();
      cleanup(path);
    }
  }, 30000);
});
