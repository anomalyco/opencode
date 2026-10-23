import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import path from "path"
import { WriteHold } from "../src/database/write-hold"
import { tmpdir } from "./fixture/tmpdir"

const child = (dir: string, mode: string, amount: number, threshold = "200") => {
  const log = path.join(dir, "child.log")
  const process = Bun.spawn(
    [
      Bun.which("bun") ?? "bun",
      `${import.meta.dir}/fixture/sqlite-write-hold-child.ts`,
      path.join(dir, "scratch.db"),
      log,
      mode,
      String(amount),
    ],
    {
      env: { ...Bun.env, OPENCODE_SQLITE_WRITE_HOLD_WARN_MS: threshold },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  return {
    process,
    async ready() {
      const reader = process.stdout.getReader()
      const chunk = await reader.read()
      reader.releaseLock()
      expect(new TextDecoder().decode(chunk.value)).toBe("locked\n")
    },
    async finished() {
      const code = await process.exited
      if (code !== 0) throw new Error(await new Response(process.stderr).text())
      return holds(log)
    },
    log,
  }
}

async function holds(log: string) {
  const file = Bun.file(log)
  if (!(await file.exists())) return []
  return (await file.text())
    .split("\n")
    .filter((line) => line.includes("sqlite.hold.event="))
    .map((line) =>
      Object.fromEntries(
        Array.from(line.matchAll(/([^\s=]+)=("(?:[^"\\]|\\.)*"|\S*)/g), (match) => [
          match[1],
          match[2].startsWith('"') ? JSON.parse(match[2]) : match[2],
        ]),
      ),
    )
}

function locked(filename: string) {
  using db = new Database(filename)
  db.run("PRAGMA busy_timeout = 0")
  try {
    db.run("BEGIN IMMEDIATE")
    db.run("ROLLBACK")
    return false
  } catch {
    return true
  }
}

describe("WriteHold", () => {
  test("names the child holding an immediate transaction while it is still held and at release", async () => {
    await using dir = await tmpdir()
    const holder = child(dir.path, "immediate", 5000)
    await holder.ready()
    const deadline = Date.now() + 4000
    while (!(await holds(holder.log)).length && Date.now() < deadline) await Bun.sleep(50)
    const [crossed] = await holds(holder.log)
    expect(crossed).toMatchObject({
      "sqlite.hold.event": "crossed",
      "sqlite.hold.pid": String(holder.process.pid),
      "sqlite.hold.command": "default",
      "sqlite.hold.sessionID": "ses_write_hold_child",
      "sqlite.hold.operation": "WriteHoldChild.hold",
      "sqlite.hold.statement": "begin immediate",
      "sqlite.hold.thresholdMs": "200",
    })
    expect(locked(path.join(dir.path, "scratch.db"))).toBe(true)

    const events = await holder.finished()
    expect(events.map((event) => event["sqlite.hold.event"])).toEqual(["crossed", "released"])
    expect(events[1]).toMatchObject({
      "sqlite.hold.pid": String(holder.process.pid),
      "sqlite.hold.statements": "3",
      "sqlite.hold.since": events[0]["sqlite.hold.since"],
    })
    expect(Number(events[1]["sqlite.hold.holdMs"])).toBeGreaterThanOrEqual(5000)
  }, 15_000)

  test("starts a deferred transaction's hold at its first write", async () => {
    await using dir = await tmpdir()
    const events = await child(dir.path, "deferred", 600).finished()
    expect(events.map((event) => [event["sqlite.hold.event"], event["sqlite.hold.statement"]])).toEqual([
      ["crossed", "insert item"],
      ["released", "insert item"],
    ])
  }, 15_000)

  test("stays silent for transactions under the threshold and when disabled", async () => {
    await using dir = await tmpdir()
    expect(await child(dir.path, "short", 20).finished()).toEqual([])
    expect(await child(dir.path, "immediate", 400, "0").finished()).toEqual([])
  }, 15_000)

  test("does not report a BEGIN that waited on another process's lock and failed", async () => {
    await using dir = await tmpdir()
    const filename = path.join(dir.path, "scratch.db")
    const holder = Bun.spawn(
      [
        Bun.which("bun") ?? "bun",
        "-e",
        'const db = new (require("bun:sqlite").Database)(process.argv[1]); db.exec("PRAGMA journal_mode = WAL"); db.exec("BEGIN IMMEDIATE"); console.log("locked"); await Bun.sleep(3000)',
        filename,
      ],
      { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    )
    const reader = holder.stdout.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("locked\n")
    reader.releaseLock()
    const events = await child(dir.path, "blocked", 400, "100")
      .finished()
      .finally(() => holder.kill())
    expect(events).toEqual([])
  }, 15_000)

  test("reports a long autocommit write after it returns", async () => {
    await using dir = await tmpdir()
    const events = await child(dir.path, "statement", 2_000_000, "50").finished()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ "sqlite.hold.event": "statement", "sqlite.hold.statement": "insert item" })
  }, 30_000)
})

describe("WriteHold.classify", () => {
  test("names only the lock-taking statement kinds", () => {
    expect(WriteHold.classify("BEGIN IMMEDIATE")).toEqual({ kind: "begin immediate", writes: true })
    expect(WriteHold.classify("begin deferred")).toEqual({ kind: "begin", writes: false })
    expect(WriteHold.classify(' insert or replace into "part" ("id") values (?)')).toEqual({
      kind: "insert part",
      writes: true,
    })
    expect(WriteHold.classify('update "session" set "title" = ?')).toEqual({ kind: "update session", writes: true })
    expect(WriteHold.classify("/* x */ DELETE FROM `message` WHERE id = ?")).toEqual({
      kind: "delete message",
      writes: true,
    })
    expect(WriteHold.classify("PRAGMA wal_checkpoint(TRUNCATE)")).toEqual({
      kind: "pragma wal_checkpoint(truncate)",
      writes: true,
    })
    expect(WriteHold.classify("PRAGMA wal_checkpoint(PASSIVE)").writes).toBe(false)
    expect(WriteHold.classify("select * from session where id = ?")).toEqual({ kind: "select", writes: false })
  })

  test("parses the threshold", () => {
    expect(WriteHold.threshold(undefined)).toBe(5000)
    expect(WriteHold.threshold("250")).toBe(250)
    expect(WriteHold.threshold("0")).toBe(0)
    expect(WriteHold.threshold("nope")).toBe(5000)
  })
})
