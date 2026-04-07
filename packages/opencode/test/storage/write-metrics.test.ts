import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"

const root = path.join(import.meta.dirname, "../..")

async function probe(file: string, body: string[]) {
  const run = Bun.spawnSync({
    cmd: [
      "bun",
      "-e",
      [
        'import { Database } from "./src/storage/db"',
        'import { Log } from "./src/util/log"',
        "await Log.init({ print: true })",
        "const db = Database.Client()",
        ...body,
        "await Bun.write(Bun.stdout, JSON.stringify({ stats: Database.stats(), monitor: Database.monitor() }))",
        "process.exit(0)",
      ].join(";"),
    ],
    cwd: root,
    env: {
      ...process.env,
      OPENCODE_DB: file,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  if (run.exitCode !== 0) {
    throw new Error(run.stderr.toString() || run.stdout.toString())
  }
  return {
    out: JSON.parse(run.stdout.toString()) as {
      stats: Record<string, number>
      monitor: {
        metrics: Record<string, number>
      }
    },
    err: run.stderr.toString(),
  }
}

describe("write metrics", () => {
  test("Database.monitor logs the planned metric keys", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "metrics.db")
    const result = await probe(file, [
      'db.$client.run("CREATE TABLE IF NOT EXISTS test (id TEXT PRIMARY KEY, data TEXT)")',
      'for (let i = 0; i < 5; i++) Database.transaction(() => db.$client.run("INSERT OR REPLACE INTO test VALUES (?, ?)", [`id-${i}`, `data-${i}`]))',
      'const shard = Database.session("metrics-session")',
      'shard.$client.run("CREATE TABLE IF NOT EXISTS local (id TEXT PRIMARY KEY, data TEXT)")',
      'shard.$client.run("INSERT OR REPLACE INTO local VALUES (?, ?)", ["id", "data"])',
    ])

    expect(result.out.stats.write).toBeGreaterThanOrEqual(5)
    expect(result.out.monitor.metrics["db.global.writes"]).toBe(result.out.stats.write)
    expect(result.out.monitor.metrics["db.global.retries"]).toBe(result.out.stats.retry)
    expect(result.out.monitor.metrics["db.global.busy_errors"]).toBe(result.out.stats.exhausted)
    expect(result.err).toContain("db.metrics")
    expect(result.err).toContain("db.global.writes")
    expect(result.err).toContain("db.global.retries")
    expect(result.err).toContain("db.global.busy_errors")
  })
})
