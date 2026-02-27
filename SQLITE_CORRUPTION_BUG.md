# SQLite Database Corruption Bug — Investigation & Fix Notes

## Filed Issue

https://github.com/sst/opencode/issues/14970

## The Problem

Running multiple opencode sessions concurrently (same or different repos) on an **NFS-mounted home directory** corrupts the shared SQLite database almost immediately after sending a message. Once corrupted, opencode cannot start at all until the database is manually deleted.

### Error on startup after corruption

```
{
  "name": "UnknownError",
  "data": {
    "message": "SQLiteError: database disk image is malformed\n    at values (unknown)\n    at get (drizzle-orm/bun-sqlite/session.js:91:25)\n    at run (node:async_hooks:62:22)\n    at use (src/storage/db.ts:111:28)\n    at fromDirectory (src/project/project.ts:193:26)\n    at async <anonymous> (src/project/instance.ts:27:52)\n    at async provide (src/project/instance.ts:40:23)"
  }
}
```

### Steps to reproduce

1. Home directory on NFS
2. Open opencode session in a repo
3. Open second opencode session (same or different repo)
4. Send a message in either session
5. Database corrupts almost immediately — crash
6. All subsequent `opencode` invocations crash until you manually delete the db

### Workaround

```bash
rm ~/.local/share/opencode/opencode.db ~/.local/share/opencode/opencode.db-shm ~/.local/share/opencode/opencode.db-wal
```

Loses all session history. Config/auth/MCP settings are unaffected.

## Environment

- **OS:** Linux 6.6.105+
- **Filesystem:** NFS-mounted home (`/mnt/home/`)
- **Runtime:** Bun
- **opencode version:** latest as of 2026-02-24
- **Evidence:** Stale `.nfs*` handle files found alongside the corrupted database in `~/.local/share/opencode/`

## Root Cause Analysis

### The database setup (packages/opencode/src/storage/db.ts)

All opencode instances share a **single global SQLite database** at `~/.local/share/opencode/opencode.db`. On init (line 72-101), it:

```typescript
const sqlite = new BunDatabase(path.join(Global.Path.data, "opencode.db"), { create: true })
sqlite.run("PRAGMA journal_mode = WAL")
sqlite.run("PRAGMA synchronous = NORMAL")
sqlite.run("PRAGMA busy_timeout = 5000")
sqlite.run("PRAGMA cache_size = -64000")
sqlite.run("PRAGMA foreign_keys = ON")
sqlite.run("PRAGMA wal_checkpoint(PASSIVE)")
```

### Why it corrupts

Two compounding issues:

#### 1. WAL mode on NFS is broken

SQLite's WAL (Write-Ahead Logging) mode uses **shared memory mappings** via the `-shm` file for coordination between readers and writers. On NFS:

- `mmap()` of the `-shm` file is not coherent across NFS clients
- POSIX `fcntl()` advisory locks (used by SQLite for concurrency control) are unreliable on NFS
- SQLite's own docs explicitly warn: ["SQLite uses POSIX advisory locks... if your NFS implementation does not support them correctly, SQLite may malfunction"](https://www.sqlite.org/faq.html#q5)

Multiple opencode processes writing via WAL on NFS = guaranteed corruption.

#### 2. No error recovery

When the database corrupts, opencode tries to open it on next startup, hits the malformed error in `Database.use()` (line 111-130), and crashes with an unhandled `SQLiteError`. There's no integrity check, no fallback, no recovery path.

### Related code paths

- **Database singleton:** `packages/opencode/src/storage/db.ts` — `Database.Client` lazy singleton, WAL config
- **Schema:** `packages/opencode/src/storage/schema.ts`, `schema.sql.ts`
- **Project init (crash site):** `packages/opencode/src/project/project.ts:193` — calls `Database.use()` during startup
- **Instance init:** `packages/opencode/src/project/instance.ts:27` — wraps project init

## Potential Fixes

### Option A: Detect NFS and switch journal mode (minimal)

On NFS, use `DELETE` journal mode instead of `WAL`. `DELETE` mode only uses file-level locks (no shared memory), which is more compatible with NFS:

```typescript
import { statfsSync } from "fs"

// NFS magic number = 0x6969
const isNFS = statfsSync(Global.Path.data).type === 0x6969

sqlite.run(isNFS ? "PRAGMA journal_mode = DELETE" : "PRAGMA journal_mode = WAL")
```

Trade-off: `DELETE` mode is slower for concurrent reads, but at least it won't corrupt.

### Option B: Per-project databases (better isolation)

Instead of one global db, use per-project databases (e.g. `~/.local/share/opencode/<project-hash>/opencode.db`). This eliminates cross-session contention entirely for the common case of sessions in different repos. Same-repo concurrent sessions would still need locking.

### Option C: Integrity check + auto-recovery on startup (defense in depth)

```typescript
const result = sqlite.prepare("PRAGMA integrity_check").get()
if (result.integrity_check !== "ok") {
  log.warn("database corrupted, recreating", { path: dbPath })
  sqlite.close()
  fs.unlinkSync(dbPath)
  // re-open fresh
}
```

This doesn't prevent corruption but makes it self-healing instead of a hard crash that requires manual intervention.

### Option D: Use a proper client-server database or file-based locking

For NFS environments, SQLite is fundamentally the wrong tool. Alternatives:
- Use a local-only path (e.g. `/tmp/opencode-<uid>/`) for the database
- Use a server-based store (PostgreSQL, etc.) for multi-session coordination

### Recommended approach

Combine **A + C**: detect NFS and downgrade journal mode, plus add integrity checks on startup for resilience. This is the smallest change that fixes the bug.

## Applied Fix

**Approach: A + C** — detect NFS, use DELETE journal mode, plus quick_check on startup.

### What changed (`packages/opencode/src/storage/db.ts`)

1. **NFS detection** via `statfsSync().type === 0x6969` (kept from prior attempt)
2. **Journal mode selection**: `DELETE` on NFS, `WAL` on local filesystems
   - DELETE mode avoids the mmap'd `-shm` file that causes corruption on NFS
   - DELETE mode uses only file-level locks, which NFS lock manager handles correctly
3. **`PRAGMA quick_check`** instead of `integrity_check` on startup
   - `integrity_check` reads every page — hangs indefinitely on large corrupt databases
   - `quick_check` catches most corruption but returns fast
4. **Corruption recovery**: if quick_check fails or the db can't be opened, delete and recreate
5. **Removed the `/tmp` relocation** from the prior attempt — it never ran (wasn't deployed), and would have caused data loss on reboot anyway

### What the prior attempt got wrong

The first fix (commit `8ac922f8c`) tried to move the database to `/tmp/opencode-<uid>/`. Problems:
- Was never deployed (the installed opencode binary was still the old one)
- Even if deployed: data lost on reboot, `systemd-tmpfiles` cleanup risk
- `PRAGMA integrity_check` on an 86MB corrupt db = hang forever (the "just sits there" symptom)
- Still used WAL mode (fine on local fs, but unnecessary complexity)

## Related Issues

- [#4251](https://github.com/sst/opencode/issues/4251) — Concurrent sessions on different repos interfere (open)
- [#5241](https://github.com/sst/opencode/issues/5241) — Sessions not saving with multi sessions (closed, "fixed accidentally")
- [#5517](https://github.com/sst/opencode/issues/5517) — Race condition in concurrent session deletion
- [#14970](https://github.com/sst/opencode/issues/14970) — Our filed issue
