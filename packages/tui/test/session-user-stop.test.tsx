import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import type { SessionInboxInfo, SessionMessageInfo } from "@opencode-ai/client"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode-ai/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const STOPPED_SHELL = "Command stopped by user. Do not restart it unless the user asks."
const STOPPED_SUBAGENT = "Subagent stopped by user. Do not restart it unless the user asks."

test.each([
  { mode: "dark" as const, width: 100 },
  { mode: "light" as const, width: 50 },
])("renders user stops neutrally while the parent is idle ($mode, $width columns)", async ({ mode, width }) => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width, height: 48, useThread: false })
  setup.renderer.start()
  const session = {
    id: "session-user-stop",
    title: "User stops",
    projectID: "project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const messages: SessionMessageInfo[] = [
    { id: "message-user", type: "user", text: "Work", time: { created: 0 } },
    {
      id: "message-user-shell",
      type: "shell",
      shellID: "shell-user",
      command: "sleep 60",
      status: "killed",
      metadata: { background: true },
      output: { output: "user shell output", cursor: 17, size: 17, truncated: false },
      time: { created: 0, completed: 1 },
    },
    {
      id: "message-tools",
      type: "assistant",
      agent: "build",
      model: { providerID: "demo", id: "demo-model" },
      content: [
        {
          type: "tool",
          id: "call-shell",
          name: "shell",
          state: {
            status: "completed",
            input: { command: "sleep 60" },
            // The real tool response: captured output first, then the model-facing sentence.
            content: [
              { type: "text", text: "Partial shell output" },
              { type: "text", text: STOPPED_SHELL },
            ],
            metadata: { status: "stopped", truncated: false },
          },
          time: { created: 1, completed: 2 },
        },
        {
          type: "tool",
          id: "call-subagent",
          name: "subagent",
          state: {
            status: "completed",
            input: { agent: "explore", description: "Inspect files" },
            content: [{ type: "text", text: STOPPED_SUBAGENT }],
            metadata: { status: "stopped", sessionID: "child-foreground" },
          },
          time: { created: 1, completed: 2 },
        },
      ],
      finish: "stop",
      time: { created: 1, completed: 2 },
    },
    {
      id: "message-instructions",
      type: "system",
      text: "Instructions",
      description: "Instructions updated",
      time: { created: 3 },
    },
    ...["cancelled", "error"].map(
      (status): SessionMessageInfo => ({
        id: `message-${status}`,
        type: "synthetic",
        text: status,
        description: "Other command",
        metadata: { source: "shell", state: status },
        time: { created: 4 },
      }),
    ),
  ]
  const pending: SessionInboxInfo[] = [
    {
      id: "message-shell-stop",
      sessionID: session.id,
      type: "synthetic",
      delivery: "steer",
      payload: {
        text: STOPPED_SHELL,
        description: "sleep 60",
        metadata: { source: "shell", state: "stopped", shellID: "shell-background" },
      },
      timeCreated: 5,
    },
  ]
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: pending })
    if (url.pathname === `/api/session/${session.id}/permission`) return json({ data: [] })
    return undefined
  }, events)
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { enabled: false }, theme: { name: "opencode", mode } }),
        update: async () => ({}),
      },
      packages: { resolve: async () => undefined },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode, complete: () => {} }),
      args: { sessionID: session.id },
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    // Inbox hydration must show the stop even though it is not in projected history.
    await setup.waitForFrame((frame) => frame.includes("Shell stopped by user"))
    const frame = setup.captureCharFrame()
    // `!` shell, shell tool, subagent tool, pending shell notice.
    expect(frame.match(/stopped by user/g)).toHaveLength(4)
    expect(frame).not.toContain("Do not restart it")
    expect(frame).toContain("Partial shell output")
    expect(frame).toContain("user shell output")
    expect(frame).not.toContain("Command cancelled")
    expect(frame).toContain("\u21b3 Explore Subagent")
    expect(frame).not.toContain("\u2713 Explore Subagent")

    // Admission alone is sufficient: the idle parent never receives a running event.
    events.emit({
      id: "evt_subagent_stopped",
      type: "session.inbox.enqueued",
      created: 6,
      durable: { aggregateID: session.id, seq: 0, version: 1 },
      data: {
        sessionID: session.id,
        inboxID: "message-subagent-stop",
        item: {
          type: "synthetic",
          delivery: "steer",
          payload: {
            text: STOPPED_SUBAGENT,
            description: "Inspect source",
            metadata: { source: "subagent", state: "stopped", agent: "explore", childID: "child" },
          },
        },
      },
    })
    await setup.waitForFrame((frame) => frame.includes("Explore stopped by user"))
    expect(setup.captureCharFrame().match(/stopped by user/g)).toHaveLength(5)
    expect(setup.captureCharFrame()).toContain("\u21b3 Shell stopped by user")
    expect(setup.captureCharFrame()).toContain("\u21b3 Explore stopped by user")
    expect(setup.captureCharFrame()).toContain("! Shell cancelled")
    expect(setup.captureCharFrame()).toContain("! Shell failed")

    const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
    const subdued = spans.find((span) => span.text.includes("Instructions updated"))!.fg.toInts()
    const stopped = spans.filter((span) => span.text.includes("stopped by user"))
    expect(stopped).toHaveLength(5)
    stopped.forEach((span) => expect(span.fg.toInts()).toEqual(subdued))
    for (const label of ["! Shell cancelled", "! Shell failed"])
      expect(spans.find((span) => span.text.includes(label))!.fg.toInts()).not.toEqual(subdued)

    events.emit({
      id: "evt_subagent_delivered",
      type: "session.inbox.delivered",
      created: 7,
      durable: { aggregateID: session.id, seq: 1, version: 1 },
      data: { sessionID: session.id, inboxID: "message-subagent-stop" },
    })
    await setup.waitForFrame(
      (frame) => frame.indexOf("Explore stopped by user") < frame.indexOf("Shell stopped by user"),
    )
    expect(setup.captureCharFrame().match(/Explore stopped by user/g)).toHaveLength(1)
  } finally {
    setup.renderer.destroy()
    await task.finally(() => server.stop(true))
  }
})
