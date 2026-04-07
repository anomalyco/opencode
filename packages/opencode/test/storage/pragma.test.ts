import { describe, expect, test, afterEach } from "bun:test"
import { Database } from "../../src/storage/db"
import path from "path"
import { tmpdir } from "../fixture/fixture"

const root = path.join(import.meta.dirname, "../..")

async function pragma(kind: "global" | "shard", sql: string) {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "pragma.db")
  const run = Bun.spawnSync({
    cmd: [
      "bun",
      "-e",
      [
        'import { Database } from "./src/storage/db"',
        "const kind = process.env.OPENCODE_PRAGMA_KIND",
        "const sql = process.env.OPENCODE_PRAGMA_SQL",
        'const db = kind === "global" ? Database.Client() : Database.session("test-session")',
        "const row = db.$client.query(`PRAGMA ${sql}`).get()",
        "process.stdout.write(JSON.stringify(row))",
      ].join(";"),
    ],
    cwd: root,
    env: {
      ...process.env,
      OPENCODE_DB: file,
      OPENCODE_PRAGMA_KIND: kind,
      OPENCODE_PRAGMA_SQL: sql,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  if (run.exitCode !== 0) {
    throw new Error(run.stderr.toString())
  }
  return JSON.parse(run.stdout.toString()) as Record<string, number | string>
}

describe("Database Pragmas", () => {
  afterEach(() => {
    Database.close()
  })

  test("global DB has busy_timeout = 10000", async () => {
    const result = await pragma("global", "busy_timeout")
    expect(Object.values(result)[0]).toBe(10000)
  })

  test("shard DB has busy_timeout = 5000", async () => {
    const result = await pragma("shard", "busy_timeout")
    expect(Object.values(result)[0]).toBe(5000)
  })

  test("global DB has mmap_size = 134217728", async () => {
    const result = await pragma("global", "mmap_size")
    expect(Object.values(result)[0]).toBe(134217728)
  })

  test("shard DB has mmap_size = 134217728", async () => {
    const result = await pragma("shard", "mmap_size")
    expect(Object.values(result)[0]).toBe(134217728)
  })

  test("global DB has temp_store = MEMORY", async () => {
    const result = await pragma("global", "temp_store")
    // MEMORY = 2
    expect(Object.values(result)[0]).toBe(2)
  })

  test("shard DB has temp_store = MEMORY", async () => {
    const result = await pragma("shard", "temp_store")
    // MEMORY = 2
    expect(Object.values(result)[0]).toBe(2)
  })

  test("global DB has journal_mode = WAL", async () => {
    const result = await pragma("global", "journal_mode")
    expect(Object.values(result)[0]).toBe("wal")
  })

  test("global DB has synchronous = NORMAL", async () => {
    const result = await pragma("global", "synchronous")
    // NORMAL = 1
    expect(Object.values(result)[0]).toBe(1)
  })

  test("global DB has foreign_keys = ON", async () => {
    const result = await pragma("global", "foreign_keys")
    expect(Object.values(result)[0]).toBe(1)
  })
})
