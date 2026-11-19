import { beforeEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = mkdtempSync(join(tmpdir(), "code-coach-test-"))
const IPC = join(root, "ipc")
process.env.COACH_DATA_DIR = root

const { default: plugin } = await import("./index.ts")

type Hook = (event: any) => Promise<void> | void

function makeCtx() {
  const hooks = new Map<string, Hook>()
  const ctx = {
    location: { directory: "C:/repo" },
    session: {
      hook: async (name: string, fn: Hook) => {
        hooks.set(name, fn)
        return () => {}
      },
    },
  }
  return { ctx, hooks }
}

function requests() {
  try {
    return readdirSync(IPC).filter((name) => name.startsWith("req-"))
  } catch {
    return []
  }
}

function textEvent(sessionID: string, text: string) {
  return { sessionID, messageID: "m1", prompt: { text } }
}

const DESTRUCTIVE = "delete all the logs from last week"

beforeEach(() => {
  rmSync(IPC, { recursive: true, force: true })
  mkdirSync(IPC, { recursive: true })
  // The plugin only writes when a daemon is alive; use this process as a
  // stand-in so the write path is exercised without a second process.
  writeFileSync(join(root, "daemon.pid"), String(process.pid))
  delete process.env.COACH_BYPASS
})

test("writes one request and returns the event untouched", async () => {
  const { ctx, hooks } = makeCtx()
  await plugin.setup(ctx as never)

  const event = textEvent("s1", DESTRUCTIVE)
  const before = structuredClone(event)
  await hooks.get("prompt")!(event)

  // The send is the developer's: the hook must not edit it.
  expect(event).toEqual(before)
  expect(event.prompt.text).toBe(DESTRUCTIVE)

  const files = requests()
  expect(files).toHaveLength(1)

  const req = JSON.parse(readFileSync(join(IPC, files[0]), "utf8"))
  expect(req.text).toBe(DESTRUCTIVE)
  expect(req.sid).toBe("s1")
  expect(req.cwd).toBe("C:/repo")
  expect(typeof req.id).toBe("string")
  expect(req.id.length).toBeGreaterThan(10)
  expect(typeof req.at).toBe("number")
})

test("returns without waiting for a daemon that never answers", async () => {
  const { ctx, hooks } = makeCtx()
  await plugin.setup(ctx as never)

  const start = Date.now()
  await hooks.get("prompt")!(textEvent("s2", DESTRUCTIVE))
  const elapsed = Date.now() - start

  // This is a regression tripwire, not a latency claim: the old design blocked
  // for 1.5 s waiting on a verdict and 5 s waiting on a card decision, so
  // anything near a second means the wait came back. One file write plus a
  // cold start on a loaded CI runner is well under this.
  expect(elapsed).toBeLessThan(1000)
  expect(requests()).toHaveLength(1)

  // The structural proof that nothing is awaited: there is no reply channel at
  // all. No verdict file, no decision file, nothing the hook could be polling.
  const names = readdirSync(IPC)
  expect(names.filter((n) => n.startsWith("res-"))).toHaveLength(0)
  expect(names.filter((n) => n.startsWith("dec-"))).toHaveLength(0)
})

test("does not leave prompt text on disk when no daemon is running", async () => {
  const { ctx, hooks } = makeCtx()
  await plugin.setup(ctx as never)
  rmSync(join(root, "daemon.pid"), { force: true })

  await hooks.get("prompt")!(textEvent("s3", DESTRUCTIVE))

  expect(requests()).toHaveLength(0)
})

test("does not write a request for a dead pid", async () => {
  const { ctx, hooks } = makeCtx()
  await plugin.setup(ctx as never)
  writeFileSync(join(root, "daemon.pid"), "999999")

  await hooks.get("prompt")!(textEvent("s4", DESTRUCTIVE))

  expect(requests()).toHaveLength(0)
})

test("continuations, slash commands, pastes, and system payloads never write", async () => {
  const { ctx, hooks } = makeCtx()
  await plugin.setup(ctx as never)
  const hook = hooks.get("prompt")!

  await hook(textEvent("s5", "ok go on"))
  await hook(textEvent("s5", "/review the auth change"))
  await hook(textEvent("s5", "x".repeat(4001)))
  await hook(textEvent("s5", "<system>compact the session summary</system>"))
  await hook(textEvent("s5", "You are a helpful assistant that reviews code"))

  process.env.COACH_BYPASS = "1"
  await hook(textEvent("s5", DESTRUCTIVE))
  delete process.env.COACH_BYPASS

  expect(requests()).toHaveLength(0)
})

test("an unwritable IPC folder fails open instead of throwing", async () => {
  const { ctx, hooks } = makeCtx()
  await plugin.setup(ctx as never)

  // Replace the folder with a file so the write cannot succeed.
  rmSync(IPC, { recursive: true, force: true })
  writeFileSync(IPC, "not a directory")

  let threw = ""
  try {
    await hooks.get("prompt")!(textEvent("s6", DESTRUCTIVE))
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error)
  }
  expect(threw).toBe("")
})

test("the prompt text never reaches plugin.log", async () => {
  const { ctx, hooks } = makeCtx()
  await plugin.setup(ctx as never)
  await hooks.get("prompt")!(textEvent("s7", DESTRUCTIVE))

  let log = ""
  try {
    log = readFileSync(join(root, "logs", "plugin.log"), "utf8")
  } catch {}

  expect(log).toContain("request len=")
  expect(log).not.toContain("logs from last week")
})
