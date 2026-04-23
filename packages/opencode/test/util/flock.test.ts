import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Flock } from "../../src/util/flock"
import { Hash } from "../../src/util/hash"
import { Process } from "../../src/util/process"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

const root = path.join(import.meta.dir, "../..")
const worker = path.join(import.meta.dir, "../fixture/flock-worker.ts")

type Msg = {
  key: string
  dir: string
  staleMs?: number
  timeoutMs?: number
  baseDelayMs?: number
  maxDelayMs?: number
  holdMs?: number
  ready?: string
  active?: string
  done?: string
}

function lock(dir: string, key: string) {
  return path.join(dir, Hash.fast(key) + ".lock")
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function exists(file: string) {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false)
}

async function wait(file: string, timeout = 3_000) {
  const stop = Date.now() + timeout
  while (Date.now() < stop) {
    if (await exists(file)) return
    await sleep(20)
  }

  throw new Error(`Timed out waiting for file: ${file}`)
}

function run(msg: Msg) {
  return Process.run([process.execPath, worker, JSON.stringify(msg)], {
    cwd: root,
    nothrow: true,
  })
}

function spawn(msg: Msg) {
  return Process.spawn([process.execPath, worker, JSON.stringify(msg)], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
}

describe("util.flock", () => {
  test("enforces mutual exclusion under process contention", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "locks")
    const done = path.join(tmp.path, "done.log")
    const active = path.join(tmp.path, "active")
    const key = "flock:stress"
    const n = 16

    const out = await Promise.all(
      Array.from({ length: n }, () =>
        run({
          key,
          dir,
          done,
          active,
          holdMs: 30,
          staleMs: 1_000,
          timeoutMs: 15_000,
        }),
      ),
    )

    expect(out.map((x) => x.code)).toEqual(Array.from({ length: n }, () => 0))
    expect(out.map((x) => x.stderr.toString()).filter(Boolean)).toEqual([])

    const lines = (await fs.readFile(done, "utf8"))
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
    expect(lines.length).toBe(n)
  }, 20_000)

  test("times out while waiting when lock is still healthy", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "locks")
    const key = "flock:timeout"
    const ready = path.join(tmp.path, "ready")
    const proc = spawn({
      key,
      dir,
      ready,
      holdMs: 20_000,
      staleMs: 10_000,
      timeoutMs: 30_000,
    })

    try {
      await wait(ready, 5_000)
      const seen: string[] = []
      const err = await Flock.withLock(key, async () => {}, {
        dir,
        staleMs: 10_000,
        timeoutMs: 1_000,
        onWait: (tick) => {
          seen.push(tick.key)
        },
      }).catch((err) => err)

      expect(err).toBeInstanceOf(Error)
      if (!(err instanceof Error)) throw err
      expect(err.message).toContain("Timed out waiting for lock")
      expect(seen.length).toBeGreaterThan(0)
      expect(seen.every((x) => x === key)).toBe(true)
    } finally {
      await Process.stop(proc).catch(() => undefined)
      await proc.exited.catch(() => undefined)
    }
  }, 15_000)

  test("recovers after a crashed lock owner", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "locks")
    const key = "flock:crash"
    const ready = path.join(tmp.path, "ready")
    const proc = spawn({
      key,
      dir,
      ready,
      holdMs: 20_000,
      staleMs: 500,
      timeoutMs: 30_000,
    })

    await wait(ready, 5_000)
    await Process.stop(proc)
    await proc.exited.catch(() => undefined)

    let hit = false
    await Flock.withLock(
      key,
      async () => {
        hit = true
      },
      {
        dir,
        staleMs: 500,
        timeoutMs: 8_000,
      },
    )

    expect(hit).toBe(true)
  }, 20_000)

  test("breaks stale lock dirs when heartbeat is missing", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "locks")
    const key = "flock:missing-heartbeat"
    const lockDir = lock(dir, key)

    await fs.mkdir(lockDir, { recursive: true })
    const old = new Date(Date.now() - 2_000)
    await fs.utimes(lockDir, old, old)

    let hit = false
    await Flock.withLock(
      key,
      async () => {
        hit = true
      },
      {
        dir,
        staleMs: 200,
        timeoutMs: 3_000,
      },
    )

    expect(hit).toBe(true)
  })

  test("recovers when a stale breaker claim was left behind", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "locks")
    const key = "flock:stale-breaker"
    const lockDir = lock(dir, key)
    const breaker = lockDir + ".breaker"

    await fs.mkdir(lockDir, { recursive: true })
    await fs.mkdir(breaker)

    const old = new Date(Date.now() - 2_000)
    await fs.utimes(lockDir, old, old)
    await fs.utimes(breaker, old, old)

    let hit = false
    await Flock.withLock(
      key,
      async () => {
        hit = true
      },
      {
        dir,
        staleMs: 200,
        timeoutMs: 3_000,
      },
    )

    expect(hit).toBe(true)
    expect(await exists(breaker)).toBe(false)
  })

  test("fails clearly if lock dir is removed while held", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "locks")
    const key = "flock:compromised"
    const lockDir = lock(dir, key)

    const err = await Flock.withLock(
      key,
      async () => {
        await fs.rm(lockDir, {
          recursive: true,
          force: true,
        })
      },
      {
        dir,
        staleMs: 1_000,
        timeoutMs: 3_000,
      },
    ).catch((err) => err)

    expect(err).toBeInstanceOf(Error)
    if (!(err instanceof Error)) throw err
    expect(err.message).toContain("compromised")

    let hit = false
    await Flock.withLock(
      key,
      async () => {
        hit = true
      },
      {
        dir,
        staleMs: 200,
        timeoutMs: 3_000,
      },
    )
    expect(hit).toBe(true)
  })

  test("writes owner metadata while lock is held", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "locks")
    const key = "flock:meta"
    const file = path.join(lock(dir, key), "meta.json")

    await Flock.withLock(
      key,
      async () => {
        const json = await Filesystem.readJson<{
          token?: unknown
          pid?: unknown
          hostname?: unknown
          createdAt?: unknown
        }>(file)

        expect(typeof json.token).toBe("string")
        expect(typeof json.pid).toBe("number")
        expect(typeof json.hostname).toBe("string")
        expect(typeof json.createdAt).toBe("string")
      },
      {
        dir,
        staleMs: 1_000,
        timeoutMs: 3_000,
      },
    )
  })

  test("supports acquire with await using", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "locks")
    const key = "flock:acquire"
    const lockDir = lock(dir, key)

    {
      await using _ = await Flock.acquire(key, {
        dir,
        staleMs: 1_000,
        timeoutMs: 3_000,
      })
      expect(await exists(lockDir)).toBe(true)
    }

    expect(await exists(lockDir)).toBe(false)
  })

  test("refuses token mismatch release and recovers from stale", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "locks")
    const key = "flock:token"
    const lockDir = lock(dir, key)
    const meta = path.join(lockDir, "meta.json")

    const err = await Flock.withLock(
      key,
      async () => {
        const json = await Filesystem.readJson<{ token?: string }>(meta)
        json.token = "tampered"
        await fs.writeFile(meta, JSON.stringify(json, null, 2))
      },
      {
        dir,
        staleMs: 500,
        timeoutMs: 3_000,
      },
    ).catch((err) => err)

    expect(err).toBeInstanceOf(Error)
    if (!(err instanceof Error)) throw err
    expect(err.message).toContain("token mismatch")
    expect(await exists(lockDir)).toBe(true)

    let hit = false
    await Flock.withLock(
      key,
      async () => {
        hit = true
      },
      {
        dir,
        staleMs: 500,
        timeoutMs: 6_000,
      },
    )
    expect(hit).toBe(true)
  })

  test("fails clearly on unwritable lock roots", async () => {
    if (process.platform === "win32") return

    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "locks")
    const key = "flock:perm"

    await fs.mkdir(dir, { recursive: true })
    await fs.chmod(dir, 0o500)

    try {
      const err = await Flock.withLock(key, async () => {}, {
        dir,
        staleMs: 100,
        timeoutMs: 500,
      }).catch((err) => err)

      expect(err).toBeInstanceOf(Error)
      if (!(err instanceof Error)) throw err
      const text = err.message
      expect(text.includes("EACCES") || text.includes("EPERM")).toBe(true)
    } finally {
      await fs.chmod(dir, 0o700)
    }
  })
})
