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
        "await Bun.write(Bun.stdout, JSON.stringify(Database.monitor()))",
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
      wal_bytes: number
      metrics: Record<string, number>
    },
    err: run.stderr.toString(),
  }
}

describe("WAL health monitoring", () => {
  test("Database.monitor logs wal size for file-backed databases", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "wal.db")
    const result = await probe(file, [
      'db.$client.run("CREATE TABLE IF NOT EXISTS test (id TEXT PRIMARY KEY, data TEXT)")',
      'for (let i = 0; i < 200; i++) db.$client.run("INSERT OR REPLACE INTO test VALUES (?, ?)", [`id-${i}`, `data-${i}`])',
    ])

    expect(result.out.wal_bytes).toBeGreaterThan(0)
    expect(result.err).toContain("wal.size")
    expect(result.err).toContain("db.metrics")
  })
})
