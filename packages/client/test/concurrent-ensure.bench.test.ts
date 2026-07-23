import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EnsureSpawnGapMs, Service } from "../src/effect/service"

// Baseline reproducer for the missing-service reconnect herd.
// Measures contender launches and recovery latency when N clients call
// Service.ensure against an absent registration. No reconnect policy under
// test — only current ensure behavior — so later PRs can keep only changes
// that reduce launches without delaying single-contender recovery.

const fixture = join(import.meta.dir, "fixture/service.ts")
const Clients = [1, 2, 4, 7] as const
// External TUI reconnect jitter under discussion; not imported (lives in tui).
const ReconnectSpreadMs = 500
// Long enough that reconnect jitter would not cover startup, short enough that
// Service.ensure does not spawn a second contender before the winner is ready.
const StartupMs = EnsureSpawnGapMs / 2

type Row = {
  clients: number
  startupMs: number
  launches: number
  announces: number
  timeToFirstMs: number
  timeToAllMs: number
  resolveMs: number[]
  url: string
}

describe("concurrent ensure benchmark", () => {
  test("measures contender count and recovery when N clients ensure a missing service", async () => {
    const rows: Row[] = []
    for (const clients of Clients) {
      rows.push(await measureCell(clients, StartupMs))
    }

    // Accounting laws for the missing-service race (not policy targets).
    for (const row of rows) {
      expect(row.launches).toBeGreaterThanOrEqual(1)
      expect(row.announces).toBe(row.clients)
      expect(row.resolveMs).toHaveLength(row.clients)
      expect(row.timeToFirstMs).toBeGreaterThanOrEqual(row.startupMs)
      expect(row.timeToAllMs).toBeGreaterThanOrEqual(row.timeToFirstMs)
      // Startup sits under EnsureSpawnGapMs, so every client should launch
      // before the winner becomes discoverable.
      expect(row.launches).toBeGreaterThanOrEqual(row.clients)
    }

    expect(StartupMs).toBeGreaterThan(ReconnectSpreadMs)
    expect(StartupMs).toBeLessThan(EnsureSpawnGapMs)

    const single = rows.find((row) => row.clients === 1)
    const herd = rows.find((row) => row.clients === 7)
    expect(single).toBeDefined()
    expect(herd).toBeDefined()
    if (single && herd) {
      expect(herd.launches).toBeGreaterThan(single.launches)
    }

    console.log(JSON.stringify({ benchmark: "concurrent-ensure", rows }, null, 2))
  }, 90_000)
})

async function measureCell(clients: number, startupMs: number): Promise<Row> {
  return withTemp(async (directory) => {
    const registration = join(directory, "service.json")
    const command = [process.execPath, fixture, registration, "delayed", String(startupMs)]
    const announces: string[] = []
    const resolveMs: number[] = []
    let firstMs: number | undefined
    const started = performance.now()

    const endpoints = await Promise.all(
      Array.from({ length: clients }, async () => {
        const endpoint = await run(
          Service.ensure({
            file: registration,
            version: "test",
            command,
            onStart: (reason) => {
              announces.push(reason)
            },
          }),
        )
        const elapsed = performance.now() - started
        resolveMs.push(elapsed)
        if (firstMs === undefined || elapsed < firstMs) firstMs = elapsed
        return endpoint
      }),
    )

    const timeToAllMs = performance.now() - started
    const timeToFirstMs = firstMs ?? timeToAllMs
    const launches = await readLaunches(registration)
    const url = endpoints[0]?.url
    if (url === undefined) throw new Error("expected at least one endpoint")
    expect(endpoints.every((endpoint) => endpoint.url === url)).toBe(true)

    const info = await Bun.file(registration).json()
    try {
      process.kill(info.pid, "SIGTERM")
    } catch {
      // Winner may have already exited during cleanup races.
    }

    return {
      clients,
      startupMs,
      launches,
      announces: announces.length,
      timeToFirstMs,
      timeToAllMs,
      resolveMs: resolveMs.sort((a, b) => a - b),
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
