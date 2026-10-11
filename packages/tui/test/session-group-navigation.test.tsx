import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Agent } from "@opencode/schema/agent"
import { SessionMessage } from "@opencode/schema/session-message"
import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { ScrollBoxRenderable, type Renderable } from "@opentui/core"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import type { SessionMessageInfo } from "@opencode/client"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"
import { mkdir } from "node:fs/promises"

test.each([
  [48, 30],
  [80, 30],
  [120, 30],
  [80, 0],
])(
  "restores exact part/group anchors at width %s with %s trailing lines",
  async (width, lines) => {
    await using state = await tmpdir()
    const setup = await createTestRenderer({ width, height: 30, useThread: false, kittyKeyboard: true })
    setup.renderer.start()
    const session = {
      id: Session.ID.make("ses_group_navigation", { disableChecks: true }),
      title: "Grouped navigation",
      projectID: Project.ID.make("proj_test", { disableChecks: true }),
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0, updated: 0 },
    }
    const other = { ...session, id: Session.ID.make("ses_other", { disableChecks: true }), title: "Other session" }
    await mkdir(`${state.path}/test/tui`, { recursive: true })
    await Bun.write(
      `${state.path}/test/tui/tabs.json`,
      JSON.stringify({
        global: {
          tabs: [
            { sessionID: Session.ID.make(session.id, { disableChecks: true }) },
            { sessionID: Session.ID.make(other.id, { disableChecks: true }) },
          ],
          unread: {},
        },
        cwd: {},
      }),
    )
    const messages: SessionMessageInfo[] = [
      {
        type: "user",
        id: SessionMessage.ID.make("msg_user", { disableChecks: true }),
        text: "User prompt",
        time: { created: 0 },
      },
      {
        type: "assistant",
        id: SessionMessage.ID.make("msg_a", { disableChecks: true }),
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          providerID: Provider.ID.make("fixture", { disableChecks: true }),
          id: Model.ID.make("fixture", { disableChecks: true }),
        },
        time: { created: 1, completed: 3 },
        content: [
          { type: "text", text: "First response" },
          {
            type: "reasoning",
            text: "**First title**\n\nFirst thought body with enough text to wrap differently at each tested terminal width, changing the target's measured offset.",
            time: { created: 1, completed: 2 },
          },
        ],
      },
      {
        type: "assistant",
        id: SessionMessage.ID.make("msg_b", { disableChecks: true }),
        agent: Agent.ID.make("build", { disableChecks: true }),
        model: {
          providerID: Provider.ID.make("fixture", { disableChecks: true }),
          id: Model.ID.make("fixture", { disableChecks: true }),
        },
        time: { created: 4, completed: 6 },
        finish: "stop",
        content: [
          { type: "reasoning", text: "**Second title**\n\nSecond thought body", time: { created: 4, completed: 5 } },
          { type: "text", text: `Second response\n${"A later line of the response.\n".repeat(lines)}Final marker` },
        ],
      },
    ]
    const calls = createFetch((url) => {
      if (url.pathname === "/api/session") return json({ data: [session, other], cursor: {} })
      if (url.pathname === `/api/session/${other.id}`) return json({ data: other })
      if (url.pathname === `/api/session/${other.id}/message`)
        return json({
          data: [
            {
              type: "user",
              id: SessionMessage.ID.make("msg_other", { disableChecks: true }),
              text: "Other session content",
              time: { created: 0 },
            },
          ],
          cursor: {},
        })
      if (url.pathname === `/api/session/${other.id}/inbox` || url.pathname === `/api/session/${other.id}/permission`)
        return json({ data: [] })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({ data: messages.toReversed(), cursor: {} })
      if (
        url.pathname === `/api/session/${session.id}/inbox` ||
        url.pathname === `/api/session/${session.id}/permission`
      )
        return json({ data: [] })
    }, createEventStream())
    const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: {
          get: async () => ({
            animations: false,
            tabs: { enabled: true, scope: "global" },
            keybinds: { "session.messages_last_user": "ctrl+shift+u", "session.message.next": "ctrl+shift+n" },
          }),
          update: async () => ({}),
        },
        packages: { prepare: async () => ({ directory: "" }) },
        args: { sessionID: Session.ID.make(session.id, { disableChecks: true }) },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
        log: () => {},
      }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
    )
    try {
      await setup.waitForFrame((frame) => frame.includes("Final marker"))
      expect(setup.captureCharFrame()).not.toContain("Second thought body")
      setup.mockInput.pressKey("u", { ctrl: true, shift: true })
      await setup.waitForFrame((frame) => frame.includes("Thought:"))
      await setup.waitForVisualIdle({ quietFrames: 3 })
      const find = (node: Renderable): ScrollBoxRenderable | undefined =>
        node instanceof ScrollBoxRenderable &&
        node.getRenderable(SessionMessage.ID.make("msg_b", { disableChecks: true }))
          ? node
          : node.getChildren().map(find).find(Boolean)
      const initial = find(setup.renderer.root)
      if (!initial) throw new Error("Missing transcript scrollbox")
      const summaryLine = setup
        .captureCharFrame()
        .split("\n")
        .findIndex((line) => line.includes("Thought:"))
      initial.scrollTo(initial.scrollTop + summaryLine - initial.viewport.y)
      await setup.waitForVisualIdle({ quietFrames: 3 })
      const summaryOffset =
        setup
          .captureCharFrame()
          .split("\n")
          .findIndex((line) => line.includes("Thought:")) - initial.viewport.y
      if (lines > 0) expect(summaryOffset).toBe(0)
      setup.mockInput.pressKey("2", { ctrl: true })
      await setup.waitForFrame((frame) => frame.includes("Other session content"))
      setup.mockInput.pressKey("1", { ctrl: true })
      await setup.waitForFrame((frame) => {
        const viewport = find(setup.renderer.root)
        return (
          !!viewport &&
          frame.split("\n").findIndex((line) => line.includes("Thought:")) - viewport.viewport.y === summaryOffset
        )
      })
      await setup.waitForVisualIdle({ quietFrames: 3 })
      expect(setup.captureCharFrame()).not.toContain("Second thought body")
      const summary = find(setup.renderer.root)
      if (!summary) throw new Error("Missing restored summary viewport")
      expect(
        setup
          .captureCharFrame()
          .split("\n")
          .findIndex((line) => line.includes("Thought:")) - summary.viewport.y,
      ).toBe(summaryOffset)
      setup.mockInput.pressKey("u", { ctrl: true, shift: true })
      await setup.waitForVisualIdle({ quietFrames: 3 })
      setup.mockInput.pressKey("n", { ctrl: true, shift: true })
      await setup.waitForVisualIdle({ quietFrames: 3 })
      setup.mockInput.pressKey("n", { ctrl: true, shift: true })
      await setup.waitForFrame((frame) => frame.includes("Second response"))
      await setup.waitForVisualIdle({ quietFrames: 3 })
      expect(setup.captureCharFrame()).not.toContain("Second thought body")
      setup.mockInput.pressKey("u", { ctrl: true, shift: true })
      await setup.waitForFrame((frame) => frame.includes("Thought:"))
      await setup.waitForVisualIdle({ quietFrames: 3 })
      const header = setup
        .captureCharFrame()
        .split("\n")
        .findIndex((line) => line.includes("Thought:"))
      await setup.mockMouse.click(8, header)
      await setup.waitForFrame((frame) => frame.includes("First thought body"))
      setup.mockInput.pressKey("u", { ctrl: true, shift: true })
      await setup.waitForVisualIdle({ quietFrames: 3 })
      setup.mockInput.pressKey("n", { ctrl: true, shift: true })
      await setup.waitForVisualIdle({ quietFrames: 3 })
      setup.mockInput.pressKey("n", { ctrl: true, shift: true })
      await setup.waitForFrame((frame) => frame.includes("Second thought body"))
      await setup.waitForVisualIdle({ quietFrames: 3 })
      const scroll = find(setup.renderer.root)
      if (!scroll) throw new Error("Missing transcript scrollbox")
      const titleLine = setup
        .captureCharFrame()
        .split("\n")
        .findIndex((line) => line.includes("Second title"))
      expect(titleLine - scroll.viewport.y).toBe(1)
      expect(scroll.scrollTop).toBeGreaterThan(0)
      setup.mockInput.pressKey("2", { ctrl: true })
      await setup.waitForFrame((frame) => frame.includes("Other session content"))
      setup.mockInput.pressKey("1", { ctrl: true })
      await setup.waitForFrame((frame) => {
        const viewport = find(setup.renderer.root)
        return (
          !!viewport && frame.split("\n").findIndex((line) => line.includes("Second title")) - viewport.viewport.y === 1
        )
      })
      await setup.waitForVisualIdle({ quietFrames: 3 })
      const restored = find(setup.renderer.root)
      if (!restored) throw new Error("Missing restored transcript")
      const restoredTitle = setup
        .captureCharFrame()
        .split("\n")
        .findIndex((line) => line.includes("Second title"))
      expect(restoredTitle - restored.viewport.y).toBe(1)
      if (lines === 0) return

      // Save inside A's second part, not relative to A's earlier text part.
      setup.mockInput.pressKey("u", { ctrl: true, shift: true })
      await setup.waitForFrame((frame) => frame.includes("First title"))
      await setup.waitForVisualIdle({ quietFrames: 3 })
      const reading = find(setup.renderer.root)
      if (!reading) throw new Error("Missing reading viewport")
      const firstTitle = setup
        .captureCharFrame()
        .split("\n")
        .findIndex((line) => line.includes("First title"))
      reading.scrollTo(reading.scrollTop + firstTitle - reading.viewport.y + 2)
      await setup.waitForVisualIdle({ quietFrames: 3 })
      const bodyOffset =
        setup
          .captureCharFrame()
          .split("\n")
          .findIndex((line) => line.includes("First thought body")) - reading.viewport.y
      expect(bodyOffset).toBe(0)
      setup.mockInput.pressKey("2", { ctrl: true })
      await setup.waitForFrame((frame) => frame.includes("Other session content"))
      setup.mockInput.pressKey("1", { ctrl: true })
      await setup.waitForFrame((frame) => {
        const viewport = find(setup.renderer.root)
        return (
          !!viewport &&
          frame.split("\n").findIndex((line) => line.includes("First thought body")) - viewport.viewport.y ===
            bodyOffset
        )
      })
      await setup.waitForVisualIdle({ quietFrames: 3 })
      const final = find(setup.renderer.root)
      if (!final) throw new Error("Missing final viewport")
      expect(
        setup
          .captureCharFrame()
          .split("\n")
          .findIndex((line) => line.includes("First thought body")) - final.viewport.y,
      ).toBe(bodyOffset)
    } finally {
      setup.renderer.destroy()
      await task
      await server.stop()
    }
  },
  15000,
)
