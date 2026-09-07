import { expect, test } from "bun:test"
import { BoxRenderable, EmbeddedTerminalRenderable, type Renderable, ScrollBoxRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode-ai/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each([80, 120, 180])("session wheel scrolling preserves pane focus at width %s", async (width) => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width, height: 36, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const session = {
    id: "ses_wheel",
    title: "Wheel focus fixture",
    projectID: "project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const pty = {
    id: "pty_fixture",
    sessionID: session.id,
    title: "Terminal",
    command: "/bin/sh",
    args: [],
    cwd: directory,
    status: "running",
    pid: 1,
    foregroundProcess: null,
    size: { cols: 48, rows: 30 },
    output: { head: 0, tail: 0 },
  }
  const text = Array.from({ length: 100 }, (_, index) => `Terminal line ${index}`).join("\r\n")
  const messages = Array.from({ length: 20 }, (_, index) => ({
    id: `message-${index}`,
    type: "user",
    text: `History message ${String(index).padStart(4, "0")}`,
    time: { created: index },
  }))
  const calls = createFetch((url, request) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    if (url.pathname === `/api/session/${session.id}/permission`) return json({ data: [] })
    if (url.pathname === `/api/experimental/session/${session.id}/terminal`)
      return json({ data: request.method === "POST" ? pty : [pty] })
    if (url.pathname === "/api/experimental/persistent-pty/pty_fixture/snapshot")
      return json({
        data: { info: pty, text, checkpoint: Buffer.from(text).toString("base64"), cursor: { x: 16, y: 29 } },
      })
    if (url.pathname === "/api/experimental/persistent-pty/pty_fixture/connect-token")
      return json({ data: { ticket: "fixture" } })
    return undefined
  }, createEventStream())
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(request, server) {
      if (new URL(request.url).pathname.endsWith("/connect") && server.upgrade(request)) return undefined
      return calls.fetch(request)
    },
    websocket: {
      open(socket) {
        socket.send(JSON.stringify({ type: "attached", inputProtocol: 1, role: "controller", info: pty }))
        socket.send(JSON.stringify({ type: "replay_complete" }))
      },
      message() {},
    },
  })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, session: { terminal: true }, tabs: { enabled: false } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitForFrame((frame) => frame.includes("History message 0019"))
    await setup.mockInput.typeText("/terminal")
    await setup.waitForFrame((frame) => frame.includes("New terminal"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Terminal line 99"))
    setup.mockInput.pressKey("x", { ctrl: true })
    setup.mockInput.pressArrow("left")
    await setup.waitForVisualIdle()
    expect(setup.renderer.currentFocusedRenderable instanceof EmbeddedTerminalRenderable).toBe(false)
    const find = (root: Renderable): ScrollBoxRenderable | undefined =>
      root instanceof ScrollBoxRenderable && root.getRenderable("message-19")
        ? root
        : root.getChildren().map(find).find(Boolean)
    const scroll = find(setup.renderer.root)
    if (!scroll) throw new Error("Session scrollbox not found")
    expect(scroll.scrollTop).toBeGreaterThan(0)
    const before = scroll.scrollTop
    await setup.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "up")
    await setup.waitForVisualIdle()
    expect(scroll.scrollTop).toBeLessThan(before)
    scroll.scrollTo(Infinity)
    await setup.waitForVisualIdle()
    setup.mockInput.pressKey("x", { ctrl: true })
    setup.mockInput.pressArrow("right")
    const terminal = setup.renderer.currentFocusedRenderable
    if (!(terminal instanceof EmbeddedTerminalRenderable)) throw new Error("Terminal was not focused")
    await setup.waitForVisualIdle()
    const focused = scroll.scrollTop
    await setup.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "up")
    await setup.waitForVisualIdle()
    expect(scroll.scrollTop).toBeLessThan(focused)
    expect(setup.renderer.currentFocusedRenderable).toBe(terminal)
    expect(setup.captureCharFrame()).toContain("Jump to latest")
    await setup.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "down")
    await setup.waitForVisualIdle()
    expect(scroll.scrollTop).toBe(focused)
    expect(setup.renderer.currentFocusedRenderable).toBe(terminal)
    await setup.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + scroll.viewport.height + 2, "up")
    await setup.waitForVisualIdle()
    expect(scroll.scrollTop).toBe(focused)
    expect(setup.renderer.currentFocusedRenderable).toBe(terminal)
    const clicks: number[] = []
    scroll.onMouseUp = () => clicks.push(1)
    await setup.mockMouse.click(scroll.viewport.x + 2, scroll.viewport.y + 2)
    await setup.waitForVisualIdle()
    expect(setup.renderer.currentFocusedRenderable).not.toBe(terminal)
    expect(clicks).toHaveLength(0)
    await setup.mockMouse.click(scroll.viewport.x + 2, scroll.viewport.y + 2)
    await setup.waitForVisualIdle()
    expect(clicks).toHaveLength(1)
    setup.mockInput.pressEscape()
    await setup.waitForVisualIdle()
    const sessionFocus = setup.renderer.currentFocusedRenderable
    const terminalFrame = () =>
      setup
        .captureCharFrame()
        .split("\n")
        .map((line) => line.slice(terminal.x))
        .join("\n")
    const terminalBefore = terminalFrame()
    await setup.mockMouse.scroll(terminal.x + 2, terminal.y + 2, "up")
    await setup.waitForVisualIdle()
    expect(terminalFrame()).not.toBe(terminalBefore)
    expect(setup.renderer.currentFocusedRenderable).toBe(sessionFocus)

    setup.mockInput.pressKey("x", { ctrl: true })
    setup.mockInput.pressArrow("right")
    await setup.waitForVisualIdle()
    const findHandle = (root: Renderable): BoxRenderable | undefined =>
      root instanceof BoxRenderable && root.zIndex === 10 && root.width === 2
        ? root
        : root.getChildren().map(findHandle).find(Boolean)
    const handle = findHandle(setup.renderer.root)
    if (!handle) throw new Error("Separator handle not found")
    const start = handle.x
    await setup.mockMouse.drag(start, 10, start + 4, 10)
    await setup.waitForVisualIdle()
    expect(handle.x).toBe(start + 4)
    expect(setup.renderer.currentFocusedRenderable).toBe(terminal)
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
})
