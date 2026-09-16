import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

/**
 * Packaged-runtime database locations.
 *
 * Inside a Bun-compiled single-file binary, `import.meta.dir` points into the
 * read-only virtual filesystem (/$bunfs/root/...). Resolving a SQLite file
 * there makes `new Database(path)` throw SQLITE_CANTOPEN and — because the
 * engine instantiates default stores at import time — kills every CLI
 * invocation, including `opencode --version`.
 *
 * Rule: explicit arg > $ENV override > packaged user-data default >
 * source-tree default. Source runs keep the legacy next-to-package path, so
 * dev behavior and existing tests are unchanged. Packaged runs fall back to
 * a writable per-user data dir. Nothing is ever migrated or replaced
 * automatically; point the env var at an existing file to reuse it.
 */

export const BUNFS_MARKER = '$bunfs';

/** True when a module directory lives inside Bun's packaged virtual FS. Pure and unit-testable. */
export function isPackagedDir(dir: string): boolean {
  return dir.includes(BUNFS_MARKER);
}

/** True when this module itself runs from inside a packaged binary. */
export function isPackagedRuntime(moduleDir: string = import.meta.dir): boolean {
  return isPackagedDir(moduleDir);
}

/** Writable per-user data dir, following the repo-wide XDG convention. */
export function userDataDir(): string {
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return join(base, 'opencode');
}

/** Default filename location for a packaged run. */
export function packagedDbPath(filename: string): string {
  return join(userDataDir(), filename);
}

/** Create the parent directory of a DB path. No-op when it exists. */
export function ensureParentDir(dbPath: string): void {
  mkdirSync(dirname(dbPath), { recursive: true });
}
