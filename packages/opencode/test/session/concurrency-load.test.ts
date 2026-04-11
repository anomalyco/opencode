import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"

const root = path.join(import.meta.dir, "../..")
const repo = path.join(root, "../..")
const worker = path.join(import.meta.dir, "../fixture/session-load-worker.ts")
const count = 20
const msgs = 50
const shardUpdates = 10
const globalUpdates = 100
const walLimit = 100 * 1024 * 1024
const soakMs = Number(process.env.OPENCODE_LOAD_SOAK_MS ?? "0")
const soak = soakMs > 0 ? test : test.skip

type Msg = {
  mode: "sharded" | "global"
  idx: number
  dir: string
  file: string
  msgs: number
  updates: number
}

type Out = {
  idx: number
  mode: "sharded" | "global"
  session: string
  started: number
  ended: number
  global: number[]
  shard: number[]
  errors: string[]
  counts: {
    created: number
    updated: number
    messages: number
    parts: number
  }
}

type Run = {
  code: number
  stdout: string
  stderr: string
  out: Out | null
}

function env(dir: string, file: string, idx: number | string) {
  return {
    ...process.env,
    OPENCODE_DB: file,
    OPENCODE_TEST_HOME: dir,
    XDG_DATA_HOME: path.join(dir, "data"),
    XDG_CACHE_HOME: path.join(dir, `cache-${idx}`),
    XDG_CONFIG_HOME: path.join(dir, `config-${idx}`),
    XDG_STATE_HOME: path.join(dir, `state-${idx}`),
  }
}

function proc(msg: Msg) {
  return Bun.spawn({
    cmd: [process.execPath, worker, JSON.stringify(msg)],
    cwd: root,
    env: env(msg.dir, msg.file, msg.idx),
    stdout: "pipe",
    stderr: "pipe",
  })
}

function warm(dir: string, file: string) {
  return Bun.spawnSync({
    cmd: [
      "bun",
      "-e",
      [
        'import "./src/server/projectors"',
        'import { Database } from "./src/storage/db"',
        'import { Log } from "./src/util/log"',
        "await Log.init({ print: false })",
        "Database.Client()",
        "Database.close()",
        "process.exit(0)",
      ].join(";"),
    ],
    cwd: root,
    env: env(dir, file, "warm"),
    stdout: "pipe",
    stderr: "pipe",
  })
}

async function text(stream: ReadableStream<Uint8Array> | number | null) {
  if (!stream || typeof stream === "number") return ""
  return new Response(stream).text()
}

async function run(msg: Msg): Promise<Run> {
  const child = proc(msg)
  const [code, stdout, stderr] = await Promise.all([child.exited, text(child.stdout), text(child.stderr)])
  const json = stdout.trim()
  return {
    code,
    stdout,
    stderr,
    out: json ? (JSON.parse(json) as Out) : null,
  }
}

function pct(list: number[], q: number) {
  if (!list.length) return 0
  const idx = Math.max(0, Math.ceil(list.length * q) - 1)
  return list[Math.min(idx, list.length - 1)]
}

function stats(list: number[]) {
  const sorted = [...list].sort((a, b) => a - b)
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    p50: pct(sorted, 0.5),
    p95: pct(sorted, 0.95),
    p99: pct(sorted, 0.99),
    max: sorted.at(-1) ?? 0,
  }
}

async function save(name: string, lines: string[]) {
  const dir = path.join(repo, ".sisyphus/evidence")
  await fs.mkdir(dir, { recursive: true })
  await Bun.write(path.join(dir, name), lines.join("\n") + "\n")
}

async function walk(dir: string): Promise<string[]> {
  const list = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const next = await Promise.all(
    list.map((item) => {
      const file = path.join(dir, item.name)
      if (item.isDirectory()) return walk(file)
      return [file]
    }),
  )
  return next.flat()
}

async function wals(dir: string) {
  const files = (await walk(dir)).filter((file) => file.endsWith(".db-wal"))
  const list = await Promise.all(
    files.map(async (file) => ({
      file,
      size: (await fs.stat(file)).size,
    })),
  )
  return list.sort((a, b) => b.size - a.size)
}

function lines(name: string, list: Run[], wal: Awaited<ReturnType<typeof wals>>, global: number[], shard: number[]) {
  const start = Math.min(...list.flatMap((item) => (item.out ? [item.out.started] : [])))
  const end = Math.max(...list.flatMap((item) => (item.out ? [item.out.ended] : [])))
  const span = Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : 0
  const total = global.length + shard.length
  const rate = span > 0 ? Number(((total * 1000) / span).toFixed(2)) : 0
  return [
    `scenario: ${name}`,
    `workers: ${list.length}`,
    `writes: ${total}`,
    `duration_ms: ${span}`,
    `throughput_per_s: ${rate}`,
    `global_stats: ${JSON.stringify(stats(global))}`,
    `shard_stats: ${JSON.stringify(stats(shard))}`,
    `wal_max_bytes: ${wal[0]?.size ?? 0}`,
    `wal_files: ${JSON.stringify(wal.slice(0, 10))}`,
    ...list.flatMap((item, i) => [
      `worker_${i}_exit: ${item.code}`,
      `worker_${i}_stdout: ${item.stdout.trim()}`,
      `worker_${i}_stderr: ${item.stderr.trim()}`,
    ]),
  ]
}

async function scenario(tmp: string, mode: Msg["mode"], updates: number) {
  const file = path.join(tmp, `${mode}.db`)
  const init = warm(tmp, file)
  if (init.exitCode !== 0) throw new Error(init.stderr.toString() || init.stdout.toString())
  const list = await Promise.all(
    Array.from({ length: count }, (_, idx) =>
      run({
        mode,
        idx,
        dir: tmp,
        file,
        msgs,
        updates,
      }),
    ),
  )
  const out = list.flatMap((item) => (item.out ? [item.out] : []))
  const global = out.flatMap((item) => item.global)
  const shard = out.flatMap((item) => item.shard)
  const wal = await wals(tmp)
  return { list, out, global, shard, wal }
}

function check(result: Awaited<ReturnType<typeof scenario>>) {
  const bad = result.list
    .map((item, idx) => ({
      idx,
      code: item.code,
      stdout: item.stdout.trim(),
      stderr: item.stderr.trim(),
    }))
    .filter((item) => item.code !== 0)
  expect(bad).toEqual([])
  expect(result.out).toHaveLength(count)
  expect(result.out.flatMap((item) => item.errors)).toEqual([])
  expect(result.list.map((item) => item.stderr).join("\n")).not.toContain("SQLITE_BUSY")
  expect(result.list.map((item) => item.stderr).join("\n")).not.toContain("SQLITE_BUSY_SNAPSHOT")
  expect(result.wal[0]?.size ?? 0).toBeLessThan(walLimit)
}

describe("session concurrency load", () => {
  test("runs 20 sharded workers without SQLITE_BUSY and keeps WAL under 100MB", async () => {
    await using tmp = await tmpdir()
    const result = await scenario(tmp.path, "sharded", shardUpdates)

    await save("task-5-load-test-sharded.txt", lines("sharded", result.list, result.wal, result.global, result.shard))

    check(result)
    expect(result.global).toHaveLength(count * (1 + shardUpdates))
    expect(result.shard).toHaveLength(count * msgs)
    expect(stats(result.shard).p99).toBeLessThan(5_000)
  }, 120_000)

  test("runs 20 global stress workers without SQLITE_BUSY and keeps WAL under 100MB", async () => {
    await using tmp = await tmpdir()
    const result = await scenario(tmp.path, "global", globalUpdates)

    await save("task-5-load-test-global.txt", lines("global", result.list, result.wal, result.global, result.shard))

    check(result)
    expect(result.global).toHaveLength(count * (1 + globalUpdates))
    expect(result.shard).toEqual([])
    expect(stats(result.global).p99).toBeLessThan(10_000)
  }, 120_000)

  soak(
    "soaks multi-process contention for the configured duration",
    async () => {
      const start = Date.now()
      let round = 0
      let max = 0
      const global: number[] = []
      const shard: number[] = []

      while (Date.now() - start < soakMs) {
        {
          await using tmp = await tmpdir()
          const result = await scenario(tmp.path, "sharded", shardUpdates)
          check(result)
          global.push(...result.global)
          shard.push(...result.shard)
          max = Math.max(max, result.wal[0]?.size ?? 0)
        }

        {
          await using tmp = await tmpdir()
          const result = await scenario(tmp.path, "global", globalUpdates)
          check(result)
          global.push(...result.global)
          max = Math.max(max, result.wal[0]?.size ?? 0)
        }

        round += 1
      }

      await save("task-5-load-test-soak.txt", [
        "scenario: soak",
        `target_ms: ${soakMs}`,
        `elapsed_ms: ${Date.now() - start}`,
        `rounds: ${round}`,
        `global_stats: ${JSON.stringify(stats(global))}`,
        `shard_stats: ${JSON.stringify(stats(shard))}`,
        `wal_max_bytes: ${max}`,
      ])

      expect(Date.now() - start).toBeGreaterThanOrEqual(soakMs)
      expect(stats(global).p99).toBeLessThan(10_000)
      expect(stats(shard).p99).toBeLessThan(5_000)
      expect(max).toBeLessThan(walLimit)
    },
    soakMs + 180_000,
  )
})
