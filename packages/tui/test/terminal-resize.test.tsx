import { expect, test } from "bun:test"
import { EmbeddedTerminalRenderable, type Renderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode-ai/util/global"
import path from "node:path"
import { tmpdir } from "./fixture/fixture"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"

test("terminal drag resizes the live PTY, persists on release, and resets to the current half", async () => {
  await using state = await tmpdir()
  await using app = await terminalFixture({ state: state.path, width: 140 })
  await app.ready()
  await app.waitFor(() => app.terminal()?.width === 68)
  const terminal = app.terminal()
  if (!terminal?.parent) throw new Error("Terminal was not mounted")
  const focused = app.renderer.currentFocusedRenderable
  expect(terminal).toMatchObject({ x: 71, width: 68 })
  expect(terminal.parent?.width).toBe(70)
  expect(focused).not.toBe(terminal)

  // Either column of the two-column handle can start a drag.
  await app.mockMouse.pressDown(70, terminal.y + 2)
  await app.mockMouse.moveTo(57, terminal.y + 2)
  await app.waitFor(() => terminal.width === 80)
  expect(terminal.parent?.width).toBe(82)
  expect(app.frames.at(-1)).toEqual({ type: 0, cols: 80, rows: terminal.height, input: "" })
  expect(await app.layout.json()).toEqual({ verticalTabsWidth: 36 })
  expect(app.renderer.currentFocusedRenderable).toBe(focused)
  await app.mockMouse.release(57, terminal.y + 2)
  await app.waitFor(async () => (await app.layout.json()).terminalWidth === 82)
  expect(await app.layout.json()).toEqual({ verticalTabsWidth: 36, terminalWidth: 82 })

  app.resize(160, 30)
  await app.waitFor(() => terminal.x === 79)
  expect(terminal.parent?.width).toBe(82)
  await app.mockMouse.doubleClick(78, terminal.y + 2)
  await app.waitFor(() => terminal.width === 78)
  await app.waitFor(async () => (await app.layout.json()).terminalWidth === 80)
  expect(await app.layout.json()).toEqual({ verticalTabsWidth: 36, terminalWidth: 80 })
  expect(app.terminal()).toBe(terminal)
  expect(app.connections).toEqual({ socket: 1, snapshot: 1, ticket: 1, events: 1, created: 0 })
  expect(app.frames.every((frame) => frame.type === 0 && frame.input === "")).toBe(true)

  app.mockInput.pressKey("F8")
  await app.waitFor(() => app.renderer.currentFocusedRenderable === terminal)
  await app.mockInput.typeText("pwd")
  await app.waitFor(
    () =>
      app.frames
        .filter((frame) => frame.type === 1)
        .map((frame) => frame.input)
        .join("") === "pwd",
  )
  expect(app.frames.filter((frame) => frame.type === 1).every((frame) => frame.cols === 78)).toBe(true)
})

test("terminal width accounts for the vertical rail and restores its preference after shrinking and hiding", async () => {
  await using state = await tmpdir()
  await using app = await terminalFixture({ state: state.path, width: 180, vertical: true })
  await app.ready()
  await app.waitFor(() => app.terminal()?.width === 70)
  const terminal = app.terminal()
  if (!terminal?.parent) throw new Error("Terminal was not mounted")
  expect(terminal).toMatchObject({ x: 109, width: 70 })
  expect(terminal.parent?.width).toBe(72)

  await app.mockMouse.pressDown(107, terminal.y + 2)
  await app.mockMouse.moveTo(89, terminal.y + 2)
  await app.waitFor(() => terminal.width === 88)
  await app.mockMouse.release(89, terminal.y + 2)
  await app.waitFor(async () => (await app.layout.json()).terminalWidth === 90)
  expect(terminal.parent?.width).toBe(90)

  app.resize(100, 30)
  await app.waitFor(() => terminal.width === 30)
  expect(terminal).toMatchObject({ x: 69, width: 30 })
  expect(await app.layout.json()).toEqual({ verticalTabsWidth: 36, terminalWidth: 90 })
  app.resize(40, 30)
  await app.waitFor(() => terminal.width === 18)
  expect(terminal.parent?.width).toBe(20)
  app.resize(180, 30)
  await app.waitFor(() => terminal.width === 88)
  expect(terminal.x).toBe(91)
  expect(await app.layout.json()).toEqual({ verticalTabsWidth: 36, terminalWidth: 90 })
  expect(app.connections).toEqual({ socket: 1, snapshot: 1, ticket: 1, events: 1, created: 0 })

  app.mockInput.pressKey("F6")
  await app.waitFor(() => !app.terminal())
  app.mockInput.pressKey("F6")
  await app.waitFor(() => app.terminal()?.width === 88)
  expect(app.terminal()?.parent?.width).toBe(90)
  expect(await app.layout.json()).toEqual({ verticalTabsWidth: 36, terminalWidth: 90 })
  expect(app.connections.created).toBe(0)
})

test("dragging an observer terminal takes control without focusing it or sending input", async () => {
  await using state = await tmpdir()
  await using app = await terminalFixture({ state: state.path, width: 120, observer: true, terminalWidth: 66 })
  await app.ready()
  const terminal = app.terminal()
  if (!terminal?.parent) throw new Error("Terminal was not mounted")
  const focused = app.renderer.currentFocusedRenderable
  expect(terminal.parent?.width).toBe(66)
  expect(focused).not.toBe(terminal)
  expect(app.frames).toEqual([])

  await app.mockMouse.pressDown(53, terminal.y + 2)
  await app.waitFor(() => app.frames.length > 0)
  expect(app.frames[0]).toMatchObject({ type: 0, cols: 64, input: "" })
  expect(app.frames[0]?.rows).toBe(terminal.parent.height)
  expect(app.renderer.currentFocusedRenderable).toBe(focused)
  await app.mockMouse.moveTo(43, terminal.y + 2)
  await app.waitFor(() => terminal.width === 74)
  await app.mockMouse.release(43, terminal.y + 2)
  await app.waitFor(async () => (await app.layout.json()).terminalWidth === 76)
  expect(app.frames.at(-1)).toEqual({ type: 0, cols: 74, rows: terminal.height, input: "" })
  expect(app.frames.every((frame) => frame.type === 0 && frame.input === "")).toBe(true)
  expect(app.renderer.currentFocusedRenderable).toBe(focused)
  expect(app.terminal()).toBe(terminal)
  expect(app.connections).toEqual({ socket: 1, snapshot: 1, ticket: 1, events: 1, created: 0 })
})

test("a batched drag into the conversation overlay preserves terminal focus until a later click", async () => {
  await using state = await tmpdir()
  await using app = await terminalFixture({ state: state.path, width: 180, vertical: true })
  await app.ready()
  await app.waitFor(() => app.terminal()?.width === 70)
  const terminal = app.terminal()
  if (!terminal?.parent) throw new Error("Terminal was not mounted")
  const composer = app.renderer.currentFocusedRenderable
  app.mockInput.pressKey("F8")
  await app.waitFor(() => app.renderer.currentFocusedRenderable === terminal)
  await app.renderOnce()

  // One stdin burst captures the overlay on the first drag before layout can move the handle.
  app.renderer.stdin.emit("data", Buffer.from("\x1b[<0;108;20M\x1b[<32;90;20M\x1b[<0;90;20m"))
  await app.waitFor(() => terminal.width === 88)
  await app.waitFor(async () => (await app.layout.json()).terminalWidth === 90)
  expect(terminal.parent.width).toBe(90)
  expect(app.frames.at(-1)).toEqual({ type: 0, cols: 88, rows: terminal.height, input: "" })
  expect(app.renderer.currentFocusedRenderable === terminal).toBe(true)
  expect(app.frames.every((frame) => frame.type === 0 && frame.input === "")).toBe(true)

  await Promise.resolve()
  app.renderer.stdin.emit("data", Buffer.from("\x1b[<0;61;20M\x1b[<0;61;20m"))
  await app.waitFor(() => app.renderer.currentFocusedRenderable === composer)
  expect(terminal.focused).toBe(false)
  expect(app.frames.every((frame) => frame.type === 0 && frame.input === "")).toBe(true)
})

async function terminalFixture(options: {
  state: string
  width: number
  vertical?: boolean
  observer?: boolean
  terminalWidth?: number
}) {
  const layout = Bun.file(path.join(options.state, "test", "tui", "layout.json"))
  await Bun.write(layout, JSON.stringify({ verticalTabsWidth: 36, terminalWidth: options.terminalWidth }))
  await Bun.write(
    path.join(options.state, "test", "tui", "session-terminal-selection.json"),
    JSON.stringify({ sessions: { dummy: "pty_fixture" } }),
  )
  await Bun.write(
    path.join(options.state, "test", "tui", "tabs.json"),
    JSON.stringify({ global: { tabs: [{ sessionID: "dummy" }], unread: {} }, cwd: {} }),
  )
  const setup = await createTestRenderer({ width: options.width, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const ready = Promise.withResolvers<void>()
  const session = {
    id: "dummy",
    title: "Terminal resize fixture",
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
    size: { cols: 48, rows: 24 },
    output: { head: 0, tail: 0 },
  }
  const checkpoint = Buffer.from("alpha beta gamma").toString("base64")
  const frames: { type: number; cols: number; rows: number; input: string }[] = []
  const connections = { socket: 0, snapshot: 0, ticket: 0, events: 0, created: 0 }
  const calls = createFetch((url, request) => {
    if (url.pathname === "/api/event") connections.events++
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === "/api/session/dummy") return json({ data: session })
    if (/^\/api\/session\/dummy\/(message|inbox|permission)$/.test(url.pathname)) return json({ data: [], cursor: {} })
    if (url.pathname === "/api/experimental/session/dummy/terminal") {
      if (request.method === "POST") connections.created++
      return json({ data: request.method === "POST" ? pty : [pty] })
    }
    if (url.pathname === "/api/experimental/persistent-pty/pty_fixture/snapshot") {
      connections.snapshot++
      return json({ data: { info: pty, text: "alpha beta gamma", checkpoint, cursor: { x: 16, y: 0 } } })
    }
    if (url.pathname === "/api/experimental/persistent-pty/pty_fixture/connect-token") {
      connections.ticket++
      return json({ data: { ticket: "fixture" } })
    }
  }, createEventStream())
  const server = Bun.serve<{ attachmentID: string | null; controller: boolean }>({
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url)
      if (
        url.pathname.endsWith("/connect") &&
        server.upgrade(request, {
          data: { attachmentID: url.searchParams.get("attachment_id"), controller: !options.observer },
        })
      )
        return undefined
      return calls.fetch(request)
    },
    websocket: {
      open(socket) {
        connections.socket++
        socket.send(
          JSON.stringify({
            type: "attached",
            inputProtocol: 1,
            role: socket.data.controller ? "controller" : "observer",
            info: pty,
          }),
        )
        socket.send(JSON.stringify({ type: "replay_complete" }))
      },
      message(socket, message) {
        const data = Buffer.from(message)
        const frame = {
          type: data.readUInt8(0),
          cols: data.readUInt16BE(1),
          rows: data.readUInt16BE(3),
          input: data.subarray(5).toString(),
        }
        frames.push(frame)
        if (!socket.data.controller) {
          socket.data.controller = true
          socket.send(JSON.stringify({ type: "controller_changed", attachmentID: socket.data.attachmentID }))
        }
        // Mirror the server's canonical size/checkpoint acknowledgement, not just the outer box width.
        if (pty.size.cols === frame.cols && pty.size.rows === frame.rows) return
        pty.size = { cols: frame.cols, rows: frame.rows }
        socket.send(JSON.stringify({ type: "resized", ...pty.size, checkpoint }))
      },
    },
  })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({
          animations: false,
          tabs: { enabled: options.vertical ?? false, layout: "vertical", scope: "global" },
          session: { terminal: true, sidebar: "hide" },
          keybinds: { "terminal.toggle": "f6", "pane.focus.right": "f8" },
        }),
        update: async () => ({}),
      },
      packages: { resolve: async () => undefined },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: options.state })), Effect.provide(FileSystem.layerNoop({}))),
  )
  return {
    ...setup,
    frames,
    connections,
    layout,
    terminal: () => findTerminal(setup.renderer.root),
    async ready() {
      await ready.promise
      await setup.waitForFrame((frame) => frame.includes("alpha beta gamma") && frame.includes("commands"))
      await setup.waitFor(() => connections.socket === 1)
    },
    async [Symbol.asyncDispose]() {
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      await task
      await server.stop(true)
    },
  }
}

function findTerminal(root: Renderable): EmbeddedTerminalRenderable | undefined {
  return root instanceof EmbeddedTerminalRenderable
    ? root
    : root
        .getChildren()
        .map(findTerminal)
        .find((terminal) => terminal !== undefined)
}
