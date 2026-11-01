import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"
import type { Config } from "../src/config"

function createExitTest(options: {
  sessionID: string
  config?: Config.Info
}) {
  const interrupted: string[] = []
  const events = createEventStream()
  const calls = createFetch((url, req) => {
    if (url.pathname === `/api/session/${options.sessionID}`)
      return json({
        data: {
          id: options.sessionID,
          projectID: "proj_test",
          title: "Exit test session",
          location: { directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
        },
      })
    if (url.pathname === `/api/session/${options.sessionID}/message`) return json({ data: [], cursor: {} })
    if (url.pathname === `/api/session/${options.sessionID}/inbox` || url.pathname === `/api/session/${options.sessionID}/permission`)
      return json({ data: [] })
    if (url.pathname === "/api/session/active") {
      return json({ data: {} })
    }
    if (url.pathname.endsWith("/interrupt") && req?.method === "POST") {
      const parts = url.pathname.split("/")
      const id = parts[parts.indexOf("session") + 1]
      interrupted.push(id)
      return json({ interrupted: true })
    }
    return undefined
  }, events)
  return { interrupted, events, calls }
}

test("app.exit prompts when current session is active in prompt mode", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  const sessionID = "ses_active_exit"
  const { interrupted, events, calls } = createExitTest({ sessionID })
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => ({ animations: false }), update: async () => ({}) },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      args: { sessionID },
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
    events.emit({
      id: "evt_active_1",
      created: 1,
      type: "session.execution.started",
      durable: { aggregateID: sessionID, seq: 1, version: 1 },
      data: { sessionID },
    })
    await setup.waitForFrame((frame) => frame.includes("esc interrupt"))
    setup.mockInput.pressKey("c", { ctrl: true })
    await setup.waitForFrame((frame) => frame.includes("session still running") && frame.includes("Stop and exit"))
    expect(setup.captureCharFrame()).toContain("1 session still running")
    expect(setup.captureCharFrame()).toContain("Stop and exit")
    expect(setup.captureCharFrame()).toContain("Exit and keep running")
    setup.mockInput.pressEnter()
    await task
    expect(interrupted).toContain(sessionID)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    server.stop()
  }
})

test("app.exit interrupts automatically when configured with stop_on_exit: interrupt", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  const sessionID = "ses_auto_interrupt"
  const { interrupted, events, calls } = createExitTest({ sessionID })
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, session: { stop_on_exit: "interrupt" } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      args: { sessionID },
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
    events.emit({
      id: "evt_active_2",
      created: 1,
      type: "session.execution.started",
      durable: { aggregateID: sessionID, seq: 1, version: 1 },
      data: { sessionID },
    })
    await setup.waitForFrame((frame) => frame.includes("esc interrupt"))
    setup.mockInput.pressKey("c", { ctrl: true })
    await task
    expect(interrupted).toContain(sessionID)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    server.stop()
  }
})

test("non-dialog teardown in prompt mode leaves active sessions running", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  const sessionID = "ses_nondialog_teardown"
  const { interrupted, events, calls } = createExitTest({ sessionID })
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => ({ animations: false }), update: async () => ({}) },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      args: { sessionID },
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
    events.emit({
      id: "evt_active_3",
      created: 1,
      type: "session.execution.started",
      durable: { aggregateID: sessionID, seq: 1, version: 1 },
      data: { sessionID },
    })
    await setup.waitForFrame((frame) => frame.includes("esc interrupt"))
    setup.renderer.destroy()
    await task
    expect(interrupted).toEqual([])
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    server.stop()
  }
})

test("terminal hangup interrupts active session", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  const sessionID = "ses_hangup_interrupt"
  const { interrupted, events, calls } = createExitTest({ sessionID })
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => ({ animations: false }), update: async () => ({}) },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      args: { sessionID },
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof TextareaRenderable)
    events.emit({
      id: "evt_active_4",
      created: 1,
      type: "session.execution.started",
      durable: { aggregateID: sessionID, seq: 1, version: 1 },
      data: { sessionID },
    })
    await setup.waitForFrame((frame) => frame.includes("esc interrupt"))
    process.emit("SIGHUP")
    await task
    expect(interrupted).toContain(sessionID)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    server.stop()
  }
})
