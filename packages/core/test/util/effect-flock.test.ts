import { describe, expect } from "bun:test"
import { spawn } from "child_process"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { testEffect } from "../lib/effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"

function lock(dir: string, key: string) {
  return path.join(dir, Hash.fast(key) + ".lock")
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
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

const root = path.join(import.meta.dir, "../..")
const worker = path.join(import.meta.dir, "../fixture/effect-flock-worker.ts")

function run(msg: Msg) {
  return new Promise<{ code: number; stdout: Buffer; stderr: Buffer }>((resolve) => {
    const proc = spawn(process.execPath, [worker, JSON.stringify(msg)], { cwd: root })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    proc.stdout?.on("data", (data) => stdout.push(Buffer.from(data)))
    proc.stderr?.on("data", (data) => stderr.push(Buffer.from(data)))
    proc.on("close", (code) => {
      resolve({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
    })
  })
}

function spawnWorker(msg: Msg) {
  return spawn(process.execPath, [worker, JSON.stringify(msg)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

async function stopWorker(proc: ReturnType<typeof spawnWorker>) {
  if (proc.exitCode !== null || proc.signalCode !== null) return

  const closed = new Promise<void>((resolve) => proc.once("close", () => resolve()))

  if (process.platform !== "win32" || !proc.pid) {
    proc.kill()
    await closed
    return
  }

  await new Promise<void>((resolve) => {
    const killProc = spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"])
    killProc.on("close", () => {
      proc.kill()
      resolve()
    })
  })
  await closed
}

async function waitForFile(file: string, timeout = 3_000) {
  const stop = Date.now() + timeout
  while (Date.now() < stop) {
    if (await exists(file)) return
    await sleep(20)
  }
  throw new Error(`Timed out waiting for file: ${file}`)
}

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

const testLayer = AppNodeBuilder.build(EffectFlock.node, [[Global.node, testGlobal]])

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("util.effect-flock", () => {
  const it = testEffect(testLayer)

  it.live(
    "refreshes held lease and regular lock heartbeats across their interval",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-heartbeat-")))
      yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(tmp, { recursive: true, force: true })))
      const dir = path.join(tmp, "locks")
      yield* Effect.scoped(
        Effect.gen(function* () {
          const lease = yield* flock.tryAcquire("lease", dir)
          expect(lease._tag).toBe("Some")
          yield* flock.acquire("regular", dir)
          const old = new Date(Date.now() - 120_000)
          yield* Effect.promise(async () => {
            for (const key of ["lease", "regular"]) {
              const target = lock(dir, key)
              await fs.utimes(path.join(target, "heartbeat"), old, old)
              await fs.utimes(path.join(target, "meta.json"), old, old)
              await fs.utimes(target, old, old)
            }
          })
          yield* Effect.sleep("21 seconds")
          for (const key of ["lease", "regular"]) {
            const mtime = yield* Effect.promise(() => fs.stat(path.join(lock(dir, key), "heartbeat")))
            expect(Date.now() - mtime.mtimeMs).toBeLessThan(5_000)
            expect((yield* flock.tryAcquire(key, dir))._tag).toBe("None")
          }
        }),
      )
    }),
    35_000,
  )

  it.live(
    "tryAcquire exposes ownership and preserves a takeover",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-lease-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:lease"
      const lockDir = lock(dir, key)
      yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* flock.tryAcquire(key, dir)
          expect(first._tag).toBe("Some")
          expect((yield* flock.tryAcquire(key, dir))._tag).toBe("None")
          const holder = yield* flock.holder(key, dir)
          expect(holder._tag).toBe("Some")
          if (holder._tag === "Some") expect(holder.value.pid).toBe(process.pid)
          if (first._tag === "None") return false
          expect(yield* first.value.verify).toBe(true)
          yield* Effect.promise(async () => {
            const old = new Date(Date.now() - 120_000)
            await fs.utimes(path.join(lockDir, "heartbeat"), old, old)
            await fs.utimes(path.join(lockDir, "meta.json"), old, old)
          })
          const second = yield* flock.tryAcquire(key, dir)
          expect(second._tag).toBe("Some")
          expect(yield* first.value.verify).toBe(false)
          if (second._tag === "None") return
          expect(yield* second.value.verify).toBe(true)
        }),
      )
      expect(yield* Effect.promise(() => exists(lockDir))).toBe(false)
      expect((yield* flock.holder(key, dir))._tag).toBe("None")
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "releasing a stale holder preserves the new owner's lock",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-takeover-")))
      yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(tmp, { recursive: true, force: true })))
      const dir = path.join(tmp, "locks")
      const key = "eflock:takeover-release"
      const lockDir = lock(dir, key)
      const ready = yield* Deferred.make<EffectFlock.Held>()
      const finish = yield* Deferred.make<void>()
      const owner = yield* Effect.gen(function* () {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const result = yield* flock.tryAcquire(key, dir)
            if (result._tag === "None") return
            yield* Deferred.succeed(ready, result.value)
            yield* Deferred.await(finish)
          }),
        )
      }).pipe(Effect.forkScoped)
      const original = yield* Deferred.await(ready)
      yield* Effect.sleep("100 millis")
      yield* Effect.promise(async () => {
        const old = new Date(Date.now() - 120_000)
        await fs.utimes(path.join(lockDir, "heartbeat"), old, old)
        await fs.utimes(path.join(lockDir, "meta.json"), old, old)
        await fs.utimes(lockDir, old, old)
      })
      const current = yield* flock.tryAcquire(key, dir)
      expect(current._tag).toBe("Some")
      expect(yield* original.verify).toBe(false)
      if (current._tag === "None") return
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(owner)
      expect(yield* Effect.promise(() => exists(lockDir))).toBe(true)
      expect(yield* current.value.verify).toBe(true)
    }),
  )

  it.live(
    "an interrupted retry loop leaves the released key available",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-wait-")))
      const dir = path.join(tmp, "locks")
      const key = "eflock:wait-interrupt"
      const lockDir = lock(dir, key)
      yield* Effect.scoped(
        Effect.gen(function* () {
          const holder = yield* flock.tryAcquire(key, dir)
          expect(holder._tag).toBe("Some")
          let waiterAcquired = false
          const waiter = yield* Effect.gen(function* () {
            while (true) {
              const result = yield* flock.tryAcquire(key, dir)
              if (result._tag === "Some") {
                waiterAcquired = true
                return
              }
              yield* Effect.sleep("50 millis")
            }
          }).pipe(Effect.forkScoped)
          yield* Effect.sleep("10 millis")
          yield* Fiber.interrupt(waiter)
          expect(waiterAcquired).toBe(false)
          expect(yield* Effect.promise(() => exists(lockDir))).toBe(true)
        }),
      )
      expect(yield* Effect.promise(() => exists(lockDir))).toBe(false)
      const fresh = yield* Effect.scoped(flock.tryAcquire(key, dir))
      expect(fresh._tag).toBe("Some")
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "acquire and release via scoped Effect",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")
      const lockDir = lock(dir, "eflock:acquire")

      yield* Effect.scoped(flock.acquire("eflock:acquire", dir))

      expect(yield* Effect.promise(() => exists(lockDir))).toBe(false)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "withLock data-first",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
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
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "withLock pipeable",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")

      let hit = false
      yield* Effect.sync(() => {
        hit = true
      }).pipe(flock.withLock("eflock:pipe", dir))
      expect(hit).toBe(true)
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "writes owner metadata",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
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
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "breaks stale lock dirs",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
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
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "recovers from stale breaker",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
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
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "detects compromise when lock dir removed",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
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
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "detects token mismatch",
    Effect.gen(function* () {
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
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
      yield* Effect.promise(() => fs.rm(tmp, { recursive: true, force: true }))
    }),
  )

  it.live(
    "fails on unwritable lock roots",
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const flock = yield* EffectFlock.Service
      const tmp = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "eflock-test-")))
      const dir = path.join(tmp, "locks")

      yield* Effect.promise(async () => {
        await fs.mkdir(dir, { recursive: true })
        await fs.chmod(dir, 0o500)
      })

      const result = yield* flock.withLock(Effect.void, "eflock:perm", dir).pipe(Effect.exit)
      // oxlint-disable-next-line no-base-to-string -- Exit has a useful toString for test assertions
      expect(String(result)).toContain("PermissionDenied")
      yield* Effect.promise(() => fs.chmod(dir, 0o700).then(() => fs.rm(tmp, { recursive: true, force: true })))
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
            Array.from({ length: n }, () => run({ key: "eflock:stress", dir, done, active, holdMs: 30 })),
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

        const proc = spawnWorker({ key: "eflock:crash", dir, ready, holdMs: 120_000 })

        try {
          await waitForFile(ready, 5_000)
          await stopWorker(proc)

          // Backdate lock files so they're past STALE_MS (60s)
          const lockDir = lock(dir, "eflock:crash")
          const old = new Date(Date.now() - 120_000)
          await fs.utimes(lockDir, old, old).catch(() => {})
          await fs.utimes(path.join(lockDir, "heartbeat"), old, old).catch(() => {})
          await fs.utimes(path.join(lockDir, "meta.json"), old, old).catch(() => {})

          const done = path.join(tmp, "done.log")
          const result = await run({ key: "eflock:crash", dir, done, holdMs: 10 })
          expect(result.code).toBe(0)
          expect(result.stderr.toString()).toBe("")
        } finally {
          await stopWorker(proc).catch(() => {})
          await fs.rm(tmp, { recursive: true, force: true })
        }
      }),
    30_000,
  )
})
