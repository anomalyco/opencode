import { expect, test } from "bun:test"
import { EmbeddedTerminalRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import type { ServerWebSocket } from "bun"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

type ToolResult = { content: { text: string }[]; isError?: boolean }

const session = (id: string) => ({
  id,
  title: `Fixture ${id}`,
  projectID: "project",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
})
const open = session("ses_mcp_open")
const other = session("ses_mcp_other")
// Served by GET /api/session/:id but missing from the initial list, so the TUI has to sync it on demand.
const lazy = session("ses_mcp_lazy")
const pty = {
  id: "pty_fixture",
  sessionID: open.id,
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

test.skipIf(process.platform === "win32")("open_terminal opens an unfocused terminal for an open session", async () => {
  await using tui = await start(true)
  const peer = await tui.mcp.promise
  expect(peer.url.searchParams.get("name")).toBe("tui")
  expect(peer.url.searchParams.get("location[directory]")).toBe(directory)
  const call = await initialize(tui)
  const callTool = (sessionID?: string) => call("open_terminal", {}, sessionID)
  await tui.setup.waitForFrame((frame) => frame.includes("Client MCP message"))
  // Mount and server.connected must not open a second connection.
  expect(tui.upgrades).toBe(1)

  expect(await callTool()).toMatchObject({ isError: true, content: [{ text: "Unknown session" }] })
  expect(await callTool("ses_mcp_missing")).toMatchObject({ isError: true, content: [{ text: "Unknown session" }] })
  expect(await callTool(other.id)).toMatchObject({ isError: true, content: [{ text: "session not open in this TUI" }] })
  expect(await callTool(lazy.id)).toMatchObject({ isError: true, content: [{ text: "session not open in this TUI" }] })
  expect(await callTool(open.id)).toMatchObject({ content: [{ text: "Opened terminal pty_fixture" }] })
  expect(tui.created).toEqual([open.id])
  await tui.setup.waitForFrame((frame) => frame.includes("Fixture shell"))
  await tui.setup.waitForVisualIdle()
  expect(tui.setup.renderer.currentFocusedRenderable instanceof EmbeddedTerminalRenderable).toBe(false)
  // A second call reuses the session's existing terminal.
  expect(await callTool(open.id)).toMatchObject({ content: [{ text: "Opened terminal pty_fixture" }] })
  expect(tui.created).toEqual([open.id])
  await tui.setup.waitForVisualIdle()
  expect(tui.setup.renderer.currentFocusedRenderable instanceof EmbeddedTerminalRenderable).toBe(false)
  expect(tui.upgrades).toBe(1)
})

test.skipIf(process.platform === "win32")("write_terminal sends text as-is to the session's terminal", async () => {
  await using tui = await start(true)
  const call = await initialize(tui)
  await tui.setup.waitForFrame((frame) => frame.includes("Client MCP message"))

  expect(await call("write_terminal", {}, open.id)).toMatchObject({
    isError: true,
    content: [{ text: "text must be a string" }],
  })
  expect(await call("write_terminal", { text: "x" }, other.id)).toMatchObject({
    isError: true,
    content: [{ text: "session not open in this TUI" }],
  })
  // With no terminal open, it opens one and delivers the input once the pane attaches.
  expect(await call("write_terminal", { text: "echo hi\n" }, open.id)).toMatchObject({
    content: [{ text: "Wrote to terminal pty_fixture" }],
  })
  expect(tui.created).toEqual([open.id])
  await tui.setup.waitFor(() => tui.input().includes("echo hi\n"))
  expect(await call("write_terminal", { text: "pwd" }, open.id)).toMatchObject({
    content: [{ text: "Wrote to terminal pty_fixture" }],
  })
  await tui.setup.waitFor(() => tui.input() === "echo hi\npwd")
  expect(tui.created).toEqual([open.id])
  await tui.setup.waitForVisualIdle()
  expect(tui.setup.renderer.currentFocusedRenderable instanceof EmbeddedTerminalRenderable).toBe(false)
})

test.skipIf(process.platform === "win32")("does not connect when the experiment is off", async () => {
  await using tui = await start(false)
  await tui.setup.waitForFrame((frame) => frame.includes("Client MCP message"))
  await tui.setup.waitFor(() => tui.requests.includes("/api/info"))
  await tui.setup.waitForVisualIdle()
  expect(tui.upgrades).toBe(0)
})

async function initialize(tui: Awaited<ReturnType<typeof start>>) {
  const peer = await tui.mcp.promise
  let next = 0
  const request = (method: string, params: unknown) => {
    const id = ++next
    const response = new Promise<{ result: ToolResult }>((resolve) => tui.responses.set(id, resolve))
    peer.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
    return response.then((message) => message.result)
  }
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "fixture", version: "1.0.0" },
  })
  peer.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))
  return (name: string, args: Record<string, unknown>, sessionID?: string) =>
    request("tools/call", {
      name,
      arguments: args,
      ...(sessionID ? { _meta: { "ai.opencode/sessionID": sessionID } } : {}),
    })
}

async function start(enabled: boolean) {
  const state = await tmpdir()
  const setup = await createTestRenderer({ width: 120, height: 36, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  const created: string[] = []
  const input: Buffer[] = []
  const requests: string[] = []
  const message = { id: "message-0", type: "user", text: "Client MCP message", time: { created: 0 } }
  const calls = createFetch((url, request) => {
    requests.push(url.pathname)
    if (url.pathname === "/api/session") return json({ data: [open, other], cursor: {} })
    for (const item of [open, other, lazy]) {
      if (url.pathname === `/api/session/${item.id}`) return json({ data: item })
      if (url.pathname === `/api/session/${item.id}/message`) return json({ data: [message], cursor: {} })
      if (url.pathname === `/api/session/${item.id}/inbox`) return json({ data: [] })
      if (url.pathname === `/api/session/${item.id}/permission`) return json({ data: [] })
      if (url.pathname === `/api/experimental/session/${item.id}/terminal`) {
        if (request.method === "POST") created.push(item.id)
        return json({ data: request.method === "POST" ? pty : created.includes(item.id) ? [pty] : [] })
      }
    }
    if (url.pathname === "/api/session/ses_mcp_missing") return json({ error: "not found" }, { status: 404 })
    if (url.pathname === "/api/experimental/persistent-pty/pty_fixture/snapshot")
      return json({
        data: { info: pty, text: "Fixture shell", checkpoint: Buffer.from("Fixture shell").toString("base64") },
      })
    if (url.pathname === "/api/experimental/persistent-pty/pty_fixture/connect-token")
      return json({ data: { ticket: "fixture" } })
    return undefined
  }, createEventStream())
  const mcp = Promise.withResolvers<{ url: URL; socket: ServerWebSocket<{ url: URL }> }>()
  const responses = new Map<number, (message: { result: ToolResult }) => void>()
  const counter = { upgrades: 0 }
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch(request, server) {
      const url = new URL(request.url)
      const client = url.pathname === "/api/experimental/client-mcp"
      if ((client || url.pathname.endsWith("/connect")) && server.upgrade(request, { data: { url } })) {
        if (client) counter.upgrades++
        return undefined
      }
      return calls.fetch(request)
    },
    websocket: {
      data: {} as { url: URL },
      open(socket) {
        if (socket.data.url.pathname === "/api/experimental/client-mcp")
          return mcp.resolve({ url: socket.data.url, socket })
        socket.send(JSON.stringify({ type: "attached", inputProtocol: 1, role: "controller", info: pty }))
        socket.send(JSON.stringify({ type: "replay_complete" }))
      },
      message(socket, text) {
        if (socket.data.url.pathname !== "/api/experimental/client-mcp") {
          // Interaction frames: [kind, cols(u16), rows(u16), ...input]; kind 1 carries input.
          if (typeof text !== "string" && text[0] === 1) input.push(text.subarray(5))
          return
        }
        const message = JSON.parse(String(text))
        responses.get(message.id)?.(message)
      },
    },
  })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { mode: "off" }, experimental: { "client-mcp": enabled } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: open.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  return {
    setup,
    created,
    requests,
    input: () => Buffer.concat(input).toString(),
    mcp,
    responses,
    get upgrades() {
      return counter.upgrades
    },
    async [Symbol.asyncDispose]() {
      try {
        setup.renderer.destroy()
        await task
      } finally {
        await server.stop(true)
        await state[Symbol.asyncDispose]()
      }
    },
  }
}
