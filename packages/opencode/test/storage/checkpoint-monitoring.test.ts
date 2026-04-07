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
      checkpoint?: {
        blocked: number
        wal_pages: number
        checkpointed_pages: number
      }
    },
    err: run.stderr.toString(),
  }
}

describe("checkpoint monitoring", () => {
  test("Database.monitor reports checkpoint payload and logs checkpoint status", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "checkpoint.db")
    const result = await probe(file, [
      'db.$client.run("CREATE TABLE IF NOT EXISTS test (id TEXT PRIMARY KEY, data TEXT)")',
      'for (let i = 0; i < 50; i++) db.$client.run("INSERT OR REPLACE INTO test VALUES (?, ?)", [`id-${i}`, `data-${i}`])',
    ])

    expect(result.out.checkpoint).toBeDefined()
    expect(typeof result.out.checkpoint?.blocked).toBe("number")
    expect(typeof result.out.checkpoint?.wal_pages).toBe("number")
    expect(typeof result.out.checkpoint?.checkpointed_pages).toBe("number")
    expect(result.err).toMatch(/wal\.checkpoint\.(complete|incomplete)/)
  })
})
