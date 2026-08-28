import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { Cause, Effect, Exit } from "effect"
import { testEffect } from "../lib/effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { EffectFlock } from "@opencode-ai/util/effect-flock"
import { Global } from "@opencode-ai/util/global"
import { Hash } from "@opencode-ai/util/hash"
import { runLockWorker, spawnLockWorker, stopLockWorker, waitForFile } from "../fixture/lock-worker"
import { tmpdir } from "../fixture/tmpdir"

function lock(dir: string, key: string) {
  return path.join(dir, Hash.fast(key) + ".lock")
}

async function exists(file: string) {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false)
}

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf8"))
}

// ---------------------------------------------------------------------------
// Worker subprocess helpers
// ---------------------------------------------------------------------------

type Msg = {
  key: string
  dir: string
  holdMs?: number
  ready?: string
  active?: string
  done?: string
}

const worker = path.join(import.meta.dir, "../fixture/effect-flock-worker.ts")

// ---------------------------------------------------------------------------
// Test layer
// ---------------------------------------------------------------------------

const testGlobal = Global.layerWith({
  home: os.homedir(),
  data: os.tmpdir(),
  cache: os.tmpdir(),
  config: os.tmpdir(),
  state: os.tmpdir(),
  bin: os.tmpdir(),
  log: os.tmpdir(),
})

const testLayer = LayerNode.compile(EffectFlock.node, [[Global.node, testGlobal]])

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("util.effect-flock", () => {
  const it = testEffect(testLayer)

  it.live(
    "acquire and release via scoped Effect",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("eflock-test-")))).path
      const dir = path.join(tmp, "locks")
      const lockDir = lock(dir, "eflock:acquire")

      yield* Effect.scoped(flock.acquire("eflock:acquire", dir))

      expect(yield* Effect.promise(() => exists(lockDir))).toBe(false)
    }),
  )

  it.live(
    "supports an acquisition timeout",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("eflock-test-")))).path
      const dir = path.join(tmp, "locks")
      const key = "eflock:timeout"

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* flock.acquire(key, dir)
          const error = yield* Effect.scoped(flock.acquire(key, dir, { staleMs: 10_000, timeoutMs: 300 })).pipe(
            Effect.flip,
          )
          expect(error._tag).toBe("LockTimeoutError")
        }),
      )
    }),
  )

  it.live(
    "withLock data-first",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("eflock-test-")))).path
      const dir = path.join(tmp, "locks")

      let hit = false
      yield* flock.withLock(
        Effect.sync(() => {
          hit = true
        }),
        "eflock:df",
        dir,
      )
      expect(hit).toBe(true)
    }),
  )

  it.live(
    "withLock pipeable",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("eflock-test-")))).path
      const dir = path.join(tmp, "locks")

      let hit = false
      yield* Effect.sync(() => {
        hit = true
      }).pipe(flock.withLock("eflock:pipe", dir))
      expect(hit).toBe(true)
    }),
  )

  it.live(
    "writes owner metadata",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("eflock-test-")))).path
      const dir = path.join(tmp, "locks")
      const key = "eflock:meta"
      const file = path.join(lock(dir, key), "meta.json")

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* flock.acquire(key, dir)
          const json = yield* Effect.promise(() =>
            readJson<{ token?: unknown; pid?: unknown; hostname?: unknown; createdAt?: unknown }>(file),
          )
          expect(typeof json.token).toBe("string")
          expect(typeof json.pid).toBe("number")
          expect(typeof json.hostname).toBe("string")
          expect(typeof json.createdAt).toBe("string")
        }),
      )
    }),
  )

  it.live(
    "breaks stale lock dirs",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("eflock-test-")))).path
      const dir = path.join(tmp, "locks")
      const key = "eflock:stale"
      const lockDir = lock(dir, key)

      yield* Effect.promise(async () => {
        await fs.mkdir(lockDir, { recursive: true })
        const old = new Date(Date.now() - 120_000)
        await fs.utimes(lockDir, old, old)
      })

      let hit = false
      yield* flock.withLock(
        Effect.sync(() => {
          hit = true
        }),
        key,
        dir,
      )
      expect(hit).toBe(true)
    }),
  )

  it.live(
    "recovers from stale breaker",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("eflock-test-")))).path
      const dir = path.join(tmp, "locks")
      const key = "eflock:stale-breaker"
      const lockDir = lock(dir, key)
      const breaker = lockDir + ".breaker"

      yield* Effect.promise(async () => {
        await fs.mkdir(lockDir, { recursive: true })
        await fs.mkdir(breaker)
        const old = new Date(Date.now() - 120_000)
        await fs.utimes(lockDir, old, old)
        await fs.utimes(breaker, old, old)
      })

      let hit = false
      yield* flock.withLock(
        Effect.sync(() => {
          hit = true
        }),
        key,
        dir,
      )
      expect(hit).toBe(true)
      expect(yield* Effect.promise(() => exists(breaker))).toBe(false)
    }),
  )

  it.live(
    "detects compromise when lock dir removed",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("eflock-test-")))).path
      const dir = path.join(tmp, "locks")
      const key = "eflock:compromised"
      const lockDir = lock(dir, key)

      const result = yield* flock
        .withLock(
          Effect.promise(() => fs.rm(lockDir, { recursive: true, force: true })),
          key,
          dir,
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(result)).toBe(true)
      expect(Exit.isFailure(result) ? Cause.pretty(result.cause) : "").toContain("missing")
    }),
  )

  it.live(
    "detects token mismatch",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("eflock-test-")))).path
      const dir = path.join(tmp, "locks")
      const key = "eflock:token"
      const lockDir = lock(dir, key)
      const meta = path.join(lockDir, "meta.json")

      const result = yield* flock
        .withLock(
          Effect.promise(async () => {
            const json = await readJson<{ token?: string }>(meta)
            json.token = "tampered"
            await fs.writeFile(meta, JSON.stringify(json, null, 2))
          }),
          key,
          dir,
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(result)).toBe(true)
      expect(Exit.isFailure(result) ? Cause.pretty(result.cause) : "").toContain("token mismatch")
      expect(yield* Effect.promise(() => exists(lockDir))).toBe(true)
    }),
  )

  it.live(
    "fails on unwritable lock roots",
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const flock = yield* EffectFlock.Service
      const tmp = (yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("eflock-test-")))).path
      const dir = path.join(tmp, "locks")

      yield* Effect.promise(async () => {
        await fs.mkdir(dir, { recursive: true })
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => fs.chmod(dir, 0o700)))
      yield* Effect.promise(() => fs.chmod(dir, 0o500))

      const result = yield* flock.withLock(Effect.void, "eflock:perm", dir).pipe(Effect.exit)
      // oxlint-disable-next-line no-base-to-string -- Exit has a useful toString for test assertions
      expect(String(result)).toContain("PermissionDenied")
    }),
  )

  it.live(
    "enforces mutual exclusion under process contention",
    () =>
      Effect.promise(async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eflock-stress-"))
        const dir = path.join(tmp, "locks")
        const done = path.join(tmp, "done.log")
        const active = path.join(tmp, "active")
        const n = 16

        try {
          const out = await Promise.all(
            Array.from({ length: n }, () =>
              runLockWorker(worker, { key: "eflock:stress", dir, done, active, holdMs: 30 } satisfies Msg),
            ),
          )

          expect(out.map((x) => x.code)).toEqual(Array.from({ length: n }, () => 0))
          expect(out.map((x) => x.stderr.toString()).filter(Boolean)).toEqual([])

          const lines = (await fs.readFile(done, "utf8"))
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean)
          expect(lines.length).toBe(n)
        } finally {
          await fs.rm(tmp, { recursive: true, force: true })
        }
      }),
    60_000,
  )

  it.live(
    "recovers after a crashed lock owner",
    () =>
      Effect.promise(async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eflock-crash-"))
        const dir = path.join(tmp, "locks")
        const ready = path.join(tmp, "ready")

        const proc = spawnLockWorker(worker, { key: "eflock:crash", dir, ready, holdMs: 120_000 } satisfies Msg)

        try {
          await waitForFile(ready, 5_000)
          await stopLockWorker(proc)

          // Backdate lock files so they're past STALE_MS (60s)
          const lockDir = lock(dir, "eflock:crash")
          const old = new Date(Date.now() - 120_000)
          await fs.utimes(lockDir, old, old).catch(() => {})
          await fs.utimes(path.join(lockDir, "heartbeat"), old, old).catch(() => {})
          await fs.utimes(path.join(lockDir, "meta.json"), old, old).catch(() => {})

          const done = path.join(tmp, "done.log")
          const result = await runLockWorker(worker, { key: "eflock:crash", dir, done, holdMs: 10 } satisfies Msg)
          expect(result.code).toBe(0)
          expect(result.stderr.toString()).toBe("")
        } finally {
          await stopLockWorker(proc).catch(() => {})
          await fs.rm(tmp, { recursive: true, force: true })
        }
      }),
    30_000,
  )
})
