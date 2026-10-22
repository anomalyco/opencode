import { expect, test } from "bun:test"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createTestRenderer } from "@opentui/core/testing"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"
import { waitForHighlightedFrame } from "./fixture/frame"

const session = {
  id: "ses_retry",
  title: "Retry session",
  projectID: "project",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}

const location = {
  directory,
  project: { id: "project", directory, canonical: directory },
}

const messages = Array.from({ length: 400 }, (_, index) =>
  index % 2
    ? {
        id: `message-${index}`,
        type: "assistant",
        agent: "build",
        model: { providerID: "demo", id: "demo-model" },
        content: [{ type: "text", text: `History message ${String(index).padStart(4, "0")}` }],
        finish: "stop",
        time: { created: index, completed: index + 1 },
      }
    : {
        id: `message-${index}`,
        type: "user",
        text: `History message ${String(index).padStart(4, "0")}`,
        time: { created: index },
      },
)

async function launch(options: { failures: number; alwaysFail?: boolean }) {
  let remaining = options.failures
  let gets = 0
  const state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  const events = createEventStream()
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/agent")
      return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
    if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
    if (url.pathname === "/api/model")
      return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === "/api/session/ses_retry") {
      gets++
      if (options.alwaysFail || remaining > 0) {
        if (!options.alwaysFail) remaining--
        return json({ message: "gone fishin" }, { status: 500 })
      }
      return json({ data: session })
    }
    if (url.pathname === "/api/session/ses_retry/message") {
      const end = Number(url.searchParams.get("cursor") ?? messages.length)
      const limit = Number(url.searchParams.get("limit"))
      const start = Math.max(0, end - limit)
      return json({ data: messages.slice(start, end).toReversed(), cursor: end ? { next: String(start) } : {} })
    }
    if (
      url.pathname === "/api/session/ses_retry/inbox" ||
      url.pathname === "/api/session/ses_retry/permission" ||
      url.pathname === "/api/session/ses_retry/form"
    )
      return json({ data: [] })
    return undefined
  }, events)
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })

  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({
          animations: false,
          tabs: { mode: "off" },
          keybinds: {},
        }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      args: { sessionID: "ses_retry" },
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  return {
    setup,
    gets: () => gets,
    [Symbol.asyncDispose]: async () => {
      try {
        if (!setup.renderer.isDestroyed) setup.renderer.destroy()
        await task.catch(() => undefined)
      } finally {
        server.stop()
        await state[Symbol.asyncDispose]()
      }
    },
  }
}

// waitForFrame stops polling once the screen goes static, which is exactly
// what happens while the retry loop sleeps between attempts. Poll on a wall
// clock instead, then assert on frames once rendering resumes.
async function poll(condition: () => boolean, timeout = 20000) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

test("a resume racing a concurrent writer retries instead of parking on home", async () => {
  await using run = await launch({ failures: 2 })
  await poll(() => run.gets() >= 3)
  await waitForHighlightedFrame(run.setup, (frame) => frame.includes("History message 0399"))
  expect(run.gets()).toBeGreaterThanOrEqual(3)
})

test("a persistently failing resume still surfaces the error and goes home", async () => {
  await using run = await launch({ failures: 0, alwaysFail: true })
  await poll(() => run.gets() >= 5)
  await poll(() => run.setup.captureCharFrame().includes("UnexpectedStatus: 500"))
  await poll(() => run.setup.captureCharFrame().includes("Demo Model"))
  expect(run.gets()).toBeGreaterThanOrEqual(5)
})
