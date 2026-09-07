import { expect, test } from "bun:test"
import { type Renderable, ScrollBoxRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode-ai/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each([40, 120])("completion notices do not navigate at width %s", async (width) => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width, height: 36, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const session = {
    id: "ses_notices",
    title: "Completion notices",
    projectID: "project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const notices = [
    { source: "shell", state: "completed", shellID: "shell-1", label: "Shell finished", description: "Done" },
    {
      source: "shell",
      state: "error",
      jobID: "shell-1",
      label: "Shell failed",
      description: "Long command ".repeat(30),
    },
    {
      source: "shell",
      state: "cancelled",
      shellID: "shell-1",
      label: "Shell cancelled",
      description: "Cancelled command",
    },
    { source: "subagent", state: "completed", sessionID: "child-1", label: "Subagent finished", description: "Done" },
    { source: "subagent", state: "error", sessionID: "child-1", label: "Subagent failed", description: "Failed" },
    {
      source: "subagent",
      state: "cancelled",
      sessionID: "child-1",
      label: "Subagent cancelled",
      description: "Cancelled",
    },
  ]
  const messages = [
    { id: "user-0", type: "user", text: "Run background tasks", time: { created: 0 } },
    {
      id: "assistant-0",
      type: "assistant",
      agent: "build",
      model: { providerID: "test", id: "test" },
      content: [
        {
          type: "tool",
          id: "shell-1",
          name: "shell",
          state: {
            status: "completed",
            input: { command: "echo done", background: true },
            content: [{ type: "text", text: "Running" }],
            metadata: { shellID: "shell-1" },
          },
          time: { created: 1, completed: 2 },
        },
      ],
      time: { created: 1, completed: 2 },
    },
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `history-${index}`,
      type: "user",
      text: `History message ${index}`,
      time: { created: index + 3 },
    })),
    ...notices.map(({ label, description, ...metadata }, index) => ({
      id: `notice-${index}`,
      type: "synthetic",
      text: label,
      description,
      metadata,
      time: { created: index + 30 },
    })),
  ]
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    if (url.pathname === `/api/session/${session.id}/permission`) return json({ data: [] })
    return undefined
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { enabled: false } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitForFrame((frame) => frame.includes("Subagent cancelled"))
    await setup.waitForVisualIdle()
    const find = (root: Renderable): ScrollBoxRenderable | undefined =>
      root instanceof ScrollBoxRenderable && root.getRenderable("history-19")
        ? root
        : root.getChildren().map(find).find(Boolean)
    const scroll = find(setup.renderer.root)
    if (!scroll) throw new Error("Session scrollbox not found")
    expect(scroll.scrollTop).toBeGreaterThan(0)
    const before = scroll.scrollTop
    for (const notice of notices) {
      const lines = setup.captureCharFrame().split("\n")
      const y = lines.findIndex((line) => line.includes(notice.label))
      expect(y).toBeGreaterThanOrEqual(0)
      const x = lines[y].indexOf(notice.label)
      await setup.mockMouse.click(x + 1, y)
      await setup.waitForVisualIdle()
      expect(scroll.scrollTop).toBe(before)
      expect(setup.renderer.currentFocusedRenderable?.id).toBe(scroll.id)
      expect(setup.captureCharFrame()).toContain(notice.label)
    }
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
})
