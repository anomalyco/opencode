import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Cause, Effect, Exit, Fiber } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-sdk"

test("releases terminal ownership after API preflight and before renderer creation", async () => {
  const core = await import("@opentui/core")
  const events: string[] = []
  const rendererError = new Error("renderer reached")
  await mock.module("@opentui/core", () => ({
    ...core,
    createCliRenderer: async () => {
      events.push("renderer")
      throw rendererError
    },
  }))
  const release = Promise.withResolvers<void>()
  const handoff = Promise.withResolvers<void>()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/fs/list") events.push("preflight")
    return undefined
  })
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromiseExit(
      run({
        server: { endpoint: { url: server.url.toString() } },
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        args: {},
        releaseTerminal: async () => {
          events.push("handoff")
          handoff.resolve()
          await release.promise
          events.push("released")
        },
        pluginHost: {
          async start() {},
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await handoff.promise
    expect(events).toEqual(["preflight", "handoff"])
    release.resolve()

    const exit = await task
    if (Exit.isSuccess(exit)) throw new Error("Expected renderer failure")
    expect(Cause.pretty(exit.cause)).toContain(rendererError.message)
    expect(events).toEqual(["preflight", "handoff", "released", "renderer"])
  } finally {
    release.resolve()
    await server.stop()
    mock.restore()
  }
})

test("does not create a renderer after terminal handoff is interrupted", async () => {
  const core = await import("@opentui/core")
  let renders = 0
  await mock.module("@opentui/core", () => ({
    ...core,
    createCliRenderer: async () => {
      renders++
      throw new Error("renderer should not start")
    },
  }))
  const release = Promise.withResolvers<void>()
  const handoff = Promise.withResolvers<void>()
  const calls = createFetch()
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })

  try {
    const { run } = await import("../src/app")
    const fiber = Effect.runFork(
      run({
        server: { endpoint: { url: server.url.toString() } },
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        args: {},
        releaseTerminal: async () => {
          handoff.resolve()
          await release.promise
        },
        pluginHost: {
          async start() {},
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await handoff.promise
    await Effect.runPromise(Fiber.interrupt(fiber))
    release.resolve()
    await Promise.resolve()
    expect(renders).toBe(0)
  } finally {
    release.resolve()
    await server.stop()
    mock.restore()
  }
})

test("does not create a renderer when terminal handoff fails", async () => {
  const core = await import("@opentui/core")
  const handoffError = new Error("terminal handoff failed")
  let renders = 0
  await mock.module("@opentui/core", () => ({
    ...core,
    createCliRenderer: async () => {
      renders++
      throw new Error("renderer should not start")
    },
  }))
  const calls = createFetch()
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })

  try {
    const { run } = await import("../src/app")
    const exit = await Effect.runPromiseExit(
      run({
        server: { endpoint: { url: server.url.toString() } },
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        args: {},
        releaseTerminal: async () => {
          throw handoffError
        },
        pluginHost: {
          async start() {},
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    if (Exit.isSuccess(exit)) throw new Error("Expected terminal handoff failure")
    expect(Cause.pretty(exit.cause)).toContain(handoffError.message)
    expect(renders).toBe(0)
  } finally {
    await server.stop()
    mock.restore()
  }
})

test("SIGHUP clears title and disposes scoped resources once", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const titles: string[] = []
  const setTitle = setup.renderer.setTerminalTitle.bind(setup.renderer)
  setup.renderer.setTerminalTitle = (title) => {
    titles.push(title)
    setTitle(title)
  }
  const listeners = new Set(process.listeners("SIGHUP"))
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  let disposes = 0

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        server: { endpoint: { url: server.url.toString() } },
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        args: {},
        log: () => {},
        pluginHost: {
          async start() {
            started()
          },
          async dispose() {
            disposes++
          },
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )
    await ready
    process.emit("SIGHUP")
    await task

    expect(setup.renderer.isDestroyed).toBe(true)
    expect(titles.at(-1)).toBe("")
    expect(disposes).toBe(1)
    expect(process.listeners("SIGHUP").every((listener) => listeners.has(listener))).toBe(true)
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
    mock.restore()
  }
})

test("session lifecycle updates the terminal title and prints the epilogue after cleanup", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  let initialTitle!: () => void
  const initialTitleSet = new Promise<void>((resolve) => {
    initialTitle = resolve
  })
  let renamedTitle!: () => void
  const renamedTitleSet = new Promise<void>((resolve) => {
    renamedTitle = resolve
  })
  const setTitle = setup.renderer.setTerminalTitle.bind(setup.renderer)
  setup.renderer.setTerminalTitle = (title) => {
    if (title === "OC | Demo session") initialTitle()
    if (title === "OC | Renamed session") renamedTitle()
    setTitle(title)
  }
  const events = createEventStream()
  const calls = createFetch((url) => {
    const session = {
      id: "dummy",
      title: "Demo session",
      projectID: "project",
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0, updated: 0 },
    }
    if (url.pathname === "/api/session")
      return json({
        data: [session],
        cursor: {},
      })
    if (url.pathname === "/api/session/dummy") return json({ data: session })
    if (url.pathname === "/api/session/dummy/message") return json({ data: [], cursor: {} })
    if (url.pathname === "/api/session/dummy/permission") return json({ data: [] })
  }, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  const originalWrite = process.stdout.write.bind(process.stdout)
  let stdout = ""
  let api: TuiPluginApi | undefined
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        server: { endpoint: { url: server.url.toString() } },
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        args: { sessionID: "dummy" },
        log: () => {},
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
    await initialTitleSet
    events.emit({
      id: "evt_renamed",
      created: 1,
      type: "session.renamed",
      durable: { aggregateID: "dummy", seq: 1, version: 1 },
      data: { sessionID: "dummy", title: "Renamed session" },
    })
    await renamedTitleSet
    api?.keymap.dispatchCommand("app.exit")
    await task

    expect(stdout).toContain("Renamed session")
    expect(stdout).toContain("opencode -s dummy")
  } finally {
    process.stdout.write = originalWrite
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
    mock.restore()
  }
})
