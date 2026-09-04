import { expect, test } from "bun:test"
import { EmbeddedTerminalRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode-ai/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each([
  { name: "exit 0", exited: true, exitCode: 0 },
  { name: "exit 1", exited: true, exitCode: 1 },
  { name: "exit without code", exited: true, exitCode: undefined },
  { name: "unexpected close", exited: false, exitCode: undefined },
])("terminal handles $name before removal", async ({ exited, exitCode }) => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 110, height: 32, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const session = {
    id: "ses_exit",
    title: "Terminal exit",
    projectID: "project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const pty = {
    id: "pty_exit",
    sessionID: session.id,
    title: "Terminal",
    command: "/bin/sh",
    args: [],
    cwd: directory,
    status: "running",
    pid: 1,
    foregroundProcess: null,
    size: { cols: 48, rows: 24 },
    output: { head: 0, tail: 0 },
  }
  const events = createEventStream()
  const lifecycle = { closed: false, removed: false }
  const calls = createFetch((url, request) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [], cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    if (url.pathname === `/api/session/${session.id}/permission`) return json({ data: [] })
    if (url.pathname === `/api/experimental/session/${session.id}/terminal`)
      return json({ data: request.method === "POST" ? pty : lifecycle.removed ? [] : [pty] })
    if (url.pathname === `/api/experimental/persistent-pty/${pty.id}/snapshot`)
      return json({
        data: { info: pty, text: "$ ", checkpoint: Buffer.from("$ ").toString("base64"), cursor: { x: 2, y: 0 } },
      })
    if (url.pathname === `/api/experimental/persistent-pty/${pty.id}/connect-token`)
      return json({ data: { ticket: "fixture" } })
    return undefined
  }, events)
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
      message(socket, message) {
        if (typeof message === "string" || !message.subarray(5).includes(13)) return
        if (exited) socket.send(JSON.stringify({ type: "exited", exitCode, finalOffset: 0 }))
        socket.close(1000)
      },
      close() {
        lifecycle.closed = true
      },
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
    await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))
    await setup.mockInput.typeText("/terminal")
    await setup.waitForFrame((frame) => frame.includes("New terminal"))
    setup.mockInput.pressEnter()
    await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof EmbeddedTerminalRenderable)
    const terminal = setup.renderer.currentFocusedRenderable!
    await setup.mockInput.typeText("exit")
    setup.mockInput.pressEnter()
    await setup.waitFor(() => lifecycle.closed)
    // Hold the separate removal event back so the websocket/SSE race is deterministic.
    await setup.waitForVisualIdle()
    expect(setup.captureCharFrame().includes("Terminal disconnected")).toBe(!exited)
    lifecycle.removed = true
    events.emit({
      id: "evt_removed",
      created: 0,
      type: "persistent-pty.removed",
      location: session.location,
      data: { sessionID: session.id, ptyID: pty.id },
    })
    await setup.waitFor(() => terminal.isDestroyed)
    expect(setup.renderer.currentFocusedRenderable instanceof EmbeddedTerminalRenderable).toBe(false)
    await setup.mockInput.typeText("back at the prompt")
    await setup.waitForFrame((frame) => frame.includes("back at the prompt"))
    setup.mockInput.pressKey("u", { ctrl: true })
  } finally {
    setup.renderer.destroy()
    events.disconnect()
    void server.stop(true)
    await task
  }
})
