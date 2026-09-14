import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { GlobalEvent, PermissionRequest } from "@opencode-ai/sdk/v2"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { createTuiResolvedConfig } from "../../../fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "../../../fixture/tui-sdk"

const sessionID = "ses_trace"
const messageID = "msg_trace"
const callID = "call_trace"
const requestID = "per_trace"

const session = {
  id: sessionID,
  slug: sessionID,
  projectID: "proj_test",
  title: "Trace session",
  directory,
  version: "0.0.0-test",
  time: { created: 1, updated: 1 },
}

const assistant = {
  id: messageID,
  sessionID,
  role: "assistant" as const,
  agent: "build",
  modelID: "model",
  providerID: "test",
  mode: "build",
  parentID: "msg_user",
  path: { cwd: directory, root: directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  system: [],
  time: { created: 1 },
}

const toolPart = {
  id: "prt_trace",
  sessionID,
  messageID,
  type: "tool" as const,
  callID,
  tool: "read",
  state: {
    status: "running" as const,
    input: { filePath: "/outside/notes.md" },
    title: "/outside/notes.md",
    time: { start: 1 },
  },
}

const completedToolPart = {
  ...toolPart,
  state: {
    status: "completed" as const,
    input: { filePath: "/outside/notes.md" },
    output: "note contents",
    title: "/outside/notes.md",
    metadata: {},
    time: { start: 1, end: 2 },
  },
}

const agents = [
  { name: "build", mode: "primary" as const, native: true, permission: {}, options: {} },
  { name: "plan", mode: "primary" as const, native: true, permission: {}, options: {} },
]

function request(tool: PermissionRequest["tool"]): PermissionRequest {
  return {
    id: requestID,
    sessionID,
    permission: "external_directory",
    patterns: ["/outside/*"],
    metadata: { filepath: "/outside/notes.md", parentDir: "/outside" },
    always: ["/outside/*"],
    tool,
  }
}

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory, project: "proj_test", payload }
}

const textPart = {
  id: "prt_text",
  sessionID,
  messageID,
  type: "text" as const,
  text: "Reading the external notes",
  time: { start: 1, end: 1 },
}

const childSessionID = "ses_trace_child"
const childSession = { ...session, id: childSessionID, parentID: sessionID, title: "Subagent" }

type BootOptions = {
  details?: { input: string; output: string }
  /** Classifier verdict; an approved request is replied to instead of being shown. */
  approved?: boolean
  /** Serve the session without its tool part, so the part has to arrive over the event stream. */
  live?: boolean
  /** Also serve a child (subagent) session whose messages the parent route never renders. */
  child?: boolean
}

async function boot(options: BootOptions = {}) {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  let classified = 0
  const calls = createFetch((url) => {
    if (url.pathname === "/agent") return json(agents)
    if (url.pathname === "/session") return json(options.child ? [session, childSession] : [session])
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${childSessionID}`) return json(childSession)
    if (url.pathname === `/session/${sessionID}/message`)
      return json([{ info: assistant, parts: options.live ? [textPart] : [textPart, toolPart] }])
    if (url.pathname.startsWith(`/session/${childSessionID}/`)) return json([])
    if (url.pathname === `/session/${sessionID}/todo`) return json([])
    if (url.pathname === `/session/${sessionID}/diff`) return json([])
    if (url.pathname === `/permission/${requestID}/classify`) {
      classified++
      return json({ approved: options.approved ?? false, ...(options.details ? { details: options.details } : {}) })
    }
    if (url.pathname === `/permission/${requestID}/reply`) return json(true)
    return undefined
  })

  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  const { run } = await import("../../../../src/app")
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      config: createTuiResolvedConfig({ plugin_enabled: {} }),
      fetch: calls.fetch,
      events: events.source,
      args: { continue: true },
      pluginHost: {
        async start(input) {
          api = input.api
          started()
        },
        async dispose() {},
      },
    }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
  )
  await ready

  const app = {
    setup,
    emit: events.emit,
    classified: () => classified,
    async frame() {
      await setup.renderOnce()
      await setup.renderOnce()
      return setup.captureCharFrame()
    },
    /** build/normal -> plan/normal -> build/review */
    async review() {
      api?.keymap.dispatchCommand("agent.cycle")
      api?.keymap.dispatchCommand("agent.cycle")
      await app.frame()
    },
    async waitForFrame(match: string, timeout = 8_000) {
      const start = Date.now()
      let frame = ""
      while (Date.now() - start < timeout) {
        frame = await app.frame()
        if (frame.includes(match)) return frame
        await Bun.sleep(20)
      }
      throw new Error(`timed out waiting for ${JSON.stringify(match)} in frame:\n${frame}`)
    },
    async stop() {
      api?.keymap.dispatchCommand("app.exit")
      await task.catch(() => {})
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      mock.restore()
    },
  }
  return app
}

test("renders the classifier trace under the tool row that triggered the permission", async () => {
  const app = await boot({ details: { input: '{"userRequest":"read the notes"}', output: "ASK" } })
  try {
    await app.waitForFrame("notes.md")
    await app.review()

    app.emit(global({ id: "evt_asked", type: "permission.asked", properties: request({ messageID, callID }) }))
    const frame = await app.waitForFrame("Classifier:")
    expect(frame).toContain("+ Classifier: ASK")
    expect(frame).toContain("Permission required")
  } finally {
    await app.stop()
  }
}, 30_000)

test("renders an auto-approved row with no classifier details", async () => {
  const app = await boot({ approved: true })
  try {
    await app.waitForFrame("notes.md")
    await app.review()

    app.emit(global({ id: "evt_asked", type: "permission.asked", properties: request({ messageID, callID }) }))
    const frame = await app.waitForFrame("Auto-approved")
    expect(frame).toContain("external_directory")
    expect(frame).toContain("/outside/*")
    expect(frame).not.toContain("Permission required")
    // No expander on this row: with details off there is nothing to open.
    expect(frame).not.toContain("+ Auto-approved")
  } finally {
    await app.stop()
  }
}, 30_000)

test("keeps the trace visible once the tool part completes", async () => {
  const app = await boot({ details: { input: '{"userRequest":"read the notes"}', output: "ASK" } })
  try {
    await app.waitForFrame("notes.md")
    await app.review()

    app.emit(global({ id: "evt_asked", type: "permission.asked", properties: request({ messageID, callID }) }))
    await app.waitForFrame("Classifier: ASK")

    app.emit(
      global({
        id: "evt_replied",
        type: "permission.replied",
        properties: { sessionID, requestID, reply: "once" },
      }),
    )
    app.emit(
      global({
        id: "evt_part_done",
        type: "message.part.updated",
        properties: { sessionID, time: 2, part: completedToolPart },
      }),
    )
    const frame = await app.waitForFrame("Classifier: ASK")
    expect(frame).not.toContain("Permission required")
  } finally {
    await app.stop()
  }
}, 30_000)

test("renders a trace for a tool part that only arrives after the classification", async () => {
  const app = await boot({ details: { input: '{"userRequest":"read the notes"}', output: "ASK" }, live: true })
  try {
    await app.waitForFrame("Reading the external notes")
    await app.review()

    app.emit(global({ id: "evt_asked", type: "permission.asked", properties: request({ messageID, callID }) }))
    await app.waitForFrame("Permission required")
    expect(app.classified()).toBe(1)

    app.emit(
      global({
        id: "evt_part",
        type: "message.part.updated",
        properties: { sessionID, time: 1, part: toolPart },
      }),
    )
    const frame = await app.waitForFrame("Classifier:")
    expect(frame).toContain("Classifier: ASK")
  } finally {
    await app.stop()
  }
}, 30_000)

test("a subagent permission shows its trace on the dialog, since its tool row is not rendered here", async () => {
  const app = await boot({ details: { input: "", output: "(unavailable: subagent_session)" }, child: true })
  try {
    await app.waitForFrame("notes.md")
    await app.review()

    app.emit(
      global({
        id: "evt_asked",
        type: "permission.asked",
        properties: {
          ...request({ messageID: "msg_trace_child", callID: "call_trace_child" }),
          sessionID: childSessionID,
        },
      }),
    )
    const frame = await app.waitForFrame("Permission required")
    expect(app.classified()).toBe(1)
    // The child's tool part belongs to a message list the parent route never renders, so the
    // dialog is the only place this trace can appear.
    expect(frame).toContain("Classifier: (unavailable: subagent_session)")
  } finally {
    await app.stop()
  }
}, 30_000)

test("cannot attach a trace to a request that carries no tool identity", async () => {
  const app = await boot({ details: { input: '{"userRequest":"read the notes"}', output: "ASK" } })
  try {
    await app.waitForFrame("notes.md")
    await app.review()

    app.emit(global({ id: "evt_asked", type: "permission.asked", properties: request(undefined) }))
    const frame = await app.waitForFrame("Permission required")
    expect(app.classified()).toBe(1)
    expect(frame).not.toContain("Classifier:")
  } finally {
    await app.stop()
  }
}, 30_000)
