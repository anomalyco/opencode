import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { waitForHighlightedFrame } from "./fixture/frame"
import { logo } from "../src/logo"

type Read = "session" | "message"

const session = {
  id: "ses_retry",
  title: "Retry session",
  projectID: "project",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const location = { directory, project: { id: "project", directory, canonical: directory } }
const messages = [
  { id: "message-1", type: "user", text: "Restore this history", time: { created: 1 } },
  {
    id: "message-2",
    type: "assistant",
    agent: "build",
    model: { providerID: "demo", id: "demo-model" },
    content: [{ type: "text", text: "History recovered" }],
    finish: "stop",
    time: { created: 2, completed: 3 },
  },
]

async function launch(options: { target: Read; failures?: number; status?: number; block?: boolean }) {
  const reads = { session: 0, message: 0 }
  const release = Promise.withResolvers<void>()
  const setup = await createAppFixture({
    args: { sessionID: session.id },
    config: { animations: false, tabs: { mode: "off" }, keybinds: { "session.new": "f6" } },
    fetch: async (url) => {
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "demo-model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === "/api/session")
        return json({ data: url.searchParams.get("parentID") === session.id ? [] : [session], cursor: {} })
      const read =
        url.pathname === `/api/session/${session.id}`
          ? "session"
          : url.pathname === `/api/session/${session.id}/message`
            ? "message"
            : undefined
      if (read) {
        reads[read]++
        if (options.block && read === options.target) await release.promise
        if (read === options.target && reads[read] <= (options.failures ?? 2)) {
          const status = options.status ?? 503
          return json(
            status === 404
              ? { _tag: "SessionNotFoundError", sessionID: session.id, message: `Session not found: ${session.id}` }
              : { message: "temporarily unavailable" },
            { status },
          )
        }
        return json(read === "session" ? { data: session } : { data: messages.toReversed(), cursor: {} })
      }
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
      return undefined
    },
  })
  await setup.ready
  return {
    ...setup,
    reads,
    release: release.resolve,
    async [Symbol.asyncDispose]() {
      release.resolve()
      await setup[Symbol.asyncDispose]()
    },
  }
}

async function wait(condition: () => boolean) {
  const deadline = Date.now() + 10_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for session recovery")
    await Bun.sleep(10)
  }
}

test.each(["session", "message"] satisfies Read[])(
  "recovers history after transient %s read failures",
  async (target) => {
    await using setup = await launch({ target })
    await wait(() => setup.reads[target] === 3)
    await waitForHighlightedFrame(setup, (frame) => frame.includes("History recovered"))
    expect(setup.captureCharFrame()).toContain("Restore this history")
    expect(setup.captureCharFrame()).not.toContain(logo.left[1])
    expect(setup.reads[target]).toBe(3)
  },
)

test("a missing session reports the error and returns to the actual home screen without retrying", async () => {
  await using setup = await launch({ target: "session", failures: Infinity, status: 404 })
  await setup.waitForFrame(
    (frame) => frame.includes(`Session not found: ${session.id}`) && frame.includes(logo.left[1]),
  )
  expect(setup.reads.session).toBe(1)
  expect(setup.captureCharFrame()).not.toContain("Restore this history")
})

// The shared retry tests control time and verify each delay. This case exercises the complete
// app's real 7.5-second retry budget and the user-visible error after all five reads fail.
test("exhausted history reads report an error instead of silently leaving an empty transcript", async () => {
  await using setup = await launch({ target: "message", failures: Infinity })
  await wait(() => setup.captureCharFrame().includes("Failed to load session history"))
  expect(setup.reads.message).toBe(5)
  expect(setup.captureCharFrame()).toContain("UnexpectedStatus: 503")
  expect(setup.captureCharFrame()).not.toContain(logo.left[1])
})

test.each(["session", "message"] satisfies Read[])(
  "leaving during an in-flight %s read cancels stale recovery",
  async (target) => {
    await using setup = await launch({ target, block: true, failures: Infinity })
    await wait(() => setup.reads[target] === 1)
    setup.mockInput.pressKey("F6")
    await setup.waitForFrame((frame) => frame.includes(logo.left[1]))
    setup.release()
    // Cross the first retry boundary to catch an obsolete read starting after the route was left.
    await Bun.sleep(600)
    expect(setup.reads[target]).toBe(1)
    expect(setup.captureCharFrame()).toContain(logo.left[1])
    expect(setup.captureCharFrame()).not.toContain("UnexpectedStatus")
    expect(setup.captureCharFrame()).not.toContain("Failed to load session history")
  },
)

test("reconnecting restarts a failed history read without stale retries or errors", async () => {
  await using setup = await launch({ target: "message", failures: 1 })
  await wait(() => setup.reads.message === 1)
  setup.events.disconnect()
  await wait(() => setup.reads.message === 2)
  await waitForHighlightedFrame(setup, (frame) => frame.includes("History recovered"))
  expect(setup.reads.message).toBe(2)
  expect(setup.captureCharFrame()).not.toContain("Failed to load session history")
})
