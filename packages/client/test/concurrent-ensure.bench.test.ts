import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EnsureSpawnGapMs, Service } from "../src/effect/service"

const fixtureServiceFilePath = join(import.meta.dir, "fixture/service.ts")
const Concurrency = [1, 2, 4, 7] as const
// Fake service startup. Must stay below EnsureSpawnGapMs so ensure does not
// spawn a second contender per client before the winner is ready.
const StartupMs = EnsureSpawnGapMs / 2

type Row = {
  concurrency: number
  startupMs: number
  launches: number
  announces: number
  recoveryMs: number
  url: string
}

describe("concurrent ensure benchmark", () => {
  test("two clients call ensure when no service is registered", async () => {
    expect(StartupMs).toBeLessThan(EnsureSpawnGapMs)

    const row = await runConcurrentEnsure(2, StartupMs)
    expect(row.announces).toBe(2)
    expect(row.launches).toBeGreaterThanOrEqual(2)
    expect(row.recoveryMs).toBeGreaterThanOrEqual(StartupMs)
  }, 30_000)

  test("reports launches and recovery for 1, 2, 4, and 7 clients", async () => {
    const rows: Row[] = []
    for (const concurrency of Concurrency) {
      rows.push(await runConcurrentEnsure(concurrency, StartupMs))
    }

    expect(rows.map((row) => row.concurrency)).toEqual([...Concurrency])
    console.log(JSON.stringify({ benchmark: "concurrent-ensure", rows }, null, 2))
  }, 90_000)
})

async function runConcurrentEnsure(concurrency: number, startupMs: number): Promise<Row> {
  return withTemp(async (directory) => {
    const registration = join(directory, "service.json")
    const command = [process.execPath, fixtureServiceFilePath, registration, "delayed", String(startupMs)]
    const announces: string[] = []
    const started = performance.now()

    const endpoints = await Promise.all(
      Array.from({ length: concurrency }, () =>
        run(
          Service.ensure({
            file: registration,
            version: "test",
            command,
            onStart: (reason) => {
              announces.push(reason)
            },
          }),
        ),
      ),
    )

    const recoveryMs = performance.now() - started
    const launches = await readLaunches(registration)
    const url = endpoints[0]?.url
    if (url === undefined) throw new Error("expected at least one endpoint")
    if (endpoints.some((endpoint) => endpoint.url !== url)) {
      throw new Error("concurrent ensure resolved to different endpoints")
    }

    const info = await Bun.file(registration).json()
    try {
      process.kill(info.pid, "SIGTERM")
    } catch {
      // Winner may have already exited during cleanup races.
    }

    return {
      concurrency,
      startupMs,
      launches,
      announces: announces.length,
      recoveryMs,
      url,
    }
  })
}

async function readLaunches(registration: string) {
  const file = Bun.file(registration + ".starts")
  if (!(await file.exists())) return 0
  return (await file.text())
    .trim()
    .split("\n")
    .filter((line) => line.length > 0).length
}

function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)))
}

async function withTemp<T>(body: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "opencode-concurrent-ensure-"))
  try {
    return await body(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
