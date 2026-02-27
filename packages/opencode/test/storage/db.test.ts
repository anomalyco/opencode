import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { statfsSync, existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from "fs"
import path from "path"
import os from "os"

// ---------------------------------------------------------------------------
// These tests verify the NFS-safety and corruption-recovery logic from
// src/storage/db.ts. We replicate the helper functions here to avoid
// importing the full module (which pulls in drizzle-orm, the global
// singleton, etc). The helpers are small — the value is in testing the
// observable behavior: NFS detection, journal mode selection, corruption
// recovery, and concurrent access.
// ---------------------------------------------------------------------------

function isNFS(dir: string): boolean {
  try {
    return statfsSync(dir).type === 0x6969
  } catch {
    return false
  }
}

function removeDatabase(dbPath: string) {
  for (const suffix of ["", "-shm", "-wal"]) {
    try {
      unlinkSync(dbPath + suffix)
    } catch {}
  }
}

/** Mirrors the Client init logic: open, quick_check, recover if needed,
 *  then set journal mode based on filesystem type. */
function initDatabase(dbPath: string, nfs?: boolean): BunDatabase {
  if (nfs === undefined) {
    nfs = isNFS(path.dirname(dbPath))
  }

  let sqlite: BunDatabase
  try {
    sqlite = new BunDatabase(dbPath, { create: true })
    const result = sqlite.prepare("PRAGMA quick_check").get() as { quick_check: string } | undefined
    if (result?.quick_check !== "ok") {
      sqlite.close()
      removeDatabase(dbPath)
      sqlite = new BunDatabase(dbPath, { create: true })
    }
  } catch {
    removeDatabase(dbPath)
    sqlite = new BunDatabase(dbPath, { create: true })
  }

  if (nfs) {
    sqlite.run("PRAGMA journal_mode = DELETE")
  } else {
    sqlite.run("PRAGMA journal_mode = WAL")
    try { sqlite.run("PRAGMA wal_checkpoint(PASSIVE)") } catch {}
  }
  sqlite.run("PRAGMA synchronous = NORMAL")
  sqlite.run("PRAGMA busy_timeout = 5000")
  sqlite.run("PRAGMA cache_size = -64000")
  sqlite.run("PRAGMA foreign_keys = ON")

  return sqlite
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `opencode-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function dbPath(name = "test.db") {
  return path.join(tmpDir, name)
}

// ---------------------------------------------------------------------------
// NFS detection
// ---------------------------------------------------------------------------

describe("NFS detection", () => {
  test("detects NFS on /mnt/home", () => {
    expect(isNFS("/mnt/home")).toBe(true)
  })

  test("returns false for local /tmp", () => {
    expect(isNFS("/tmp")).toBe(false)
  })

  test("returns false for nonexistent path", () => {
    expect(isNFS("/does/not/exist")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Journal mode selection
// ---------------------------------------------------------------------------

describe("journal mode", () => {
  test("uses DELETE mode when NFS is detected", () => {
    const p = dbPath()
    const sqlite = initDatabase(p, true)
    const mode = (sqlite.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode
    expect(mode).toBe("delete")
    sqlite.close()
  })

  test("uses WAL mode on local filesystem", () => {
    const p = dbPath()
    const sqlite = initDatabase(p, false)
    const mode = (sqlite.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode
    expect(mode).toBe("wal")
    sqlite.close()
  })

  test("DELETE mode does not create -shm or -wal files", () => {
    const p = dbPath()
    const sqlite = initDatabase(p, true)
    sqlite.run("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    sqlite.run("INSERT INTO t VALUES (1)")
    expect(existsSync(p + "-shm")).toBe(false)
    expect(existsSync(p + "-wal")).toBe(false)
    sqlite.close()
  })
})

// ---------------------------------------------------------------------------
// removeDatabase
// ---------------------------------------------------------------------------

describe("removeDatabase", () => {
  test("removes db, -shm, and -wal files", () => {
    const p = dbPath()
    writeFileSync(p, "x")
    writeFileSync(p + "-shm", "x")
    writeFileSync(p + "-wal", "x")

    removeDatabase(p)

    expect(existsSync(p)).toBe(false)
    expect(existsSync(p + "-shm")).toBe(false)
    expect(existsSync(p + "-wal")).toBe(false)
  })

  test("does not throw when nothing exists", () => {
    expect(() => removeDatabase(dbPath("nope.db"))).not.toThrow()
  })

  test("removes only the files that exist", () => {
    const p = dbPath()
    writeFileSync(p, "x")

    removeDatabase(p)
    expect(existsSync(p)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Corruption recovery
// ---------------------------------------------------------------------------

describe("corruption recovery", () => {
  test("healthy database passes quick_check", () => {
    const p = dbPath()
    const sqlite = initDatabase(p)

    sqlite.run("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    sqlite.run("INSERT INTO t VALUES (1)")

    const result = (sqlite.prepare("PRAGMA quick_check").get() as { quick_check: string })
    expect(result.quick_check).toBe("ok")
    sqlite.close()
  })

  test("corrupted database is detected and recreated", () => {
    const p = dbPath()

    // Create a valid database
    const sqlite = new BunDatabase(p, { create: true })
    sqlite.run("PRAGMA journal_mode = WAL")
    sqlite.run("CREATE TABLE important (id INTEGER PRIMARY KEY, data TEXT)")
    sqlite.run("INSERT INTO important VALUES (1, 'will be lost')")
    sqlite.close()

    // Corrupt it
    const buf = Buffer.from(new Uint8Array(Bun.file(p).arrayBuffer() as unknown as ArrayBuffer))
    for (let i = 100; i < Math.min(buf.length, 512); i++) {
      buf[i] = buf[i]! ^ 0xff
    }
    writeFileSync(p, buf)

    // initDatabase should recover
    const recovered = initDatabase(p)
    const check = (recovered.prepare("PRAGMA quick_check").get() as { quick_check: string })
    expect(check.quick_check).toBe("ok")

    // Old data is gone (trade-off: data loss vs permanent crash)
    recovered.run("CREATE TABLE important (id INTEGER PRIMARY KEY, data TEXT)")
    expect(recovered.prepare("SELECT * FROM important").all().length).toBe(0)
    recovered.close()
  })

  test("completely garbage file is recoverable", () => {
    const p = dbPath()
    writeFileSync(p, Buffer.alloc(4096, 0xde))

    const sqlite = initDatabase(p)
    sqlite.run("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    sqlite.run("INSERT INTO t VALUES (42)")
    const row = sqlite.prepare("SELECT id FROM t").get() as { id: number }
    expect(row.id).toBe(42)
    sqlite.close()
  })

  test("empty file is handled", () => {
    const p = dbPath()
    writeFileSync(p, "")

    const sqlite = initDatabase(p)
    const check = (sqlite.prepare("PRAGMA quick_check").get() as { quick_check: string })
    expect(check.quick_check).toBe("ok")
    sqlite.close()
  })

  test("missing file creates fresh database", () => {
    const p = dbPath("fresh.db")
    expect(existsSync(p)).toBe(false)

    const sqlite = initDatabase(p)
    sqlite.run("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    expect((sqlite.prepare("PRAGMA quick_check").get() as any).quick_check).toBe("ok")
    sqlite.close()
  })

  test("stale -shm/-wal files are cleaned up during recovery", () => {
    const p = dbPath()
    writeFileSync(p, Buffer.alloc(4096, 0xde))
    writeFileSync(p + "-shm", "stale")
    writeFileSync(p + "-wal", "stale")

    const sqlite = initDatabase(p)
    expect((sqlite.prepare("PRAGMA quick_check").get() as any).quick_check).toBe("ok")
    sqlite.close()
  })
})

// ---------------------------------------------------------------------------
// Concurrent access — the user scenario that was breaking
// ---------------------------------------------------------------------------

describe("concurrent sessions", () => {
  test("two connections can interleave writes with WAL mode", () => {
    const p = dbPath()

    const db1 = initDatabase(p)
    db1.run("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT, text TEXT)")

    const db2 = new BunDatabase(p)
    db2.run("PRAGMA journal_mode = WAL")
    db2.run("PRAGMA busy_timeout = 5000")

    db1.run("INSERT INTO messages (session, text) VALUES ('s1', 'hello from 1')")
    db2.run("INSERT INTO messages (session, text) VALUES ('s2', 'hello from 2')")
    db1.run("INSERT INTO messages (session, text) VALUES ('s1', 'again from 1')")
    db2.run("INSERT INTO messages (session, text) VALUES ('s2', 'again from 2')")

    const all1 = db1.prepare("SELECT * FROM messages ORDER BY id").all() as any[]
    const all2 = db2.prepare("SELECT * FROM messages ORDER BY id").all() as any[]

    expect(all1.length).toBe(4)
    expect(all2.length).toBe(4)
    expect(all1.map((r: any) => r.text)).toEqual(all2.map((r: any) => r.text))

    expect((db1.prepare("PRAGMA quick_check").get() as any).quick_check).toBe("ok")
    expect((db2.prepare("PRAGMA quick_check").get() as any).quick_check).toBe("ok")

    db1.close()
    db2.close()
  })

  test("two connections can interleave writes with DELETE mode (NFS-safe)", () => {
    const p = dbPath()

    const db1 = initDatabase(p, true)
    db1.run("CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT, text TEXT)")

    const db2 = new BunDatabase(p)
    db2.run("PRAGMA journal_mode = DELETE")
    db2.run("PRAGMA busy_timeout = 5000")

    db1.run("INSERT INTO messages (session, text) VALUES ('s1', 'hello from 1')")
    db2.run("INSERT INTO messages (session, text) VALUES ('s2', 'hello from 2')")
    db1.run("INSERT INTO messages (session, text) VALUES ('s1', 'again from 1')")
    db2.run("INSERT INTO messages (session, text) VALUES ('s2', 'again from 2')")

    const all1 = db1.prepare("SELECT * FROM messages ORDER BY id").all() as any[]
    const all2 = db2.prepare("SELECT * FROM messages ORDER BY id").all() as any[]

    expect(all1.length).toBe(4)
    expect(all2.length).toBe(4)

    expect((db1.prepare("PRAGMA quick_check").get() as any).quick_check).toBe("ok")

    db1.close()
    db2.close()
  })

  test("writes from one connection are immediately visible to the other", () => {
    const p = dbPath()

    const db1 = initDatabase(p)
    db1.run("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)")

    const db2 = new BunDatabase(p)
    db2.run("PRAGMA journal_mode = WAL")
    db2.run("PRAGMA busy_timeout = 5000")

    db1.run("INSERT INTO kv VALUES ('a', '1')")
    expect((db2.prepare("SELECT value FROM kv WHERE key = 'a'").get() as any).value).toBe("1")

    db2.run("UPDATE kv SET value = '2' WHERE key = 'a'")
    expect((db1.prepare("SELECT value FROM kv WHERE key = 'a'").get() as any).value).toBe("2")

    db1.close()
    db2.close()
  })

  test("100 rapid interleaved writes stay consistent", () => {
    const p = dbPath()

    const db1 = initDatabase(p)
    db1.run("CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT, src INTEGER, seq INTEGER)")

    const db2 = new BunDatabase(p)
    db2.run("PRAGMA journal_mode = WAL")
    db2.run("PRAGMA busy_timeout = 5000")

    const N = 100
    for (let i = 0; i < N; i++) {
      db1.run("INSERT INTO log (src, seq) VALUES (1, ?)", [i])
      db2.run("INSERT INTO log (src, seq) VALUES (2, ?)", [i])
    }

    const count = (db1.prepare("SELECT COUNT(*) as c FROM log").get() as { c: number }).c
    expect(count).toBe(N * 2)
    expect((db1.prepare("PRAGMA quick_check").get() as any).quick_check).toBe("ok")

    db1.close()
    db2.close()
  })
})
