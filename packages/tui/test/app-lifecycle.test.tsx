import { expect, mock, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"

test("SIGHUP clears title and disposes scoped resources once", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const titles: string[] = []
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const setTitle = setup.renderer.setTerminalTitle.bind(setup.renderer)
  setup.renderer.setTerminalTitle = (title) => {
    titles.push(title)
    if (title === "OpenCode") started()
    setTitle(title)
  }
  const listeners = new Set(process.listeners("SIGHUP"))
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: { get: async () => ({}), update: async () => ({}) },
        packages: { resolve: async () => undefined },
        args: {},
        log: () => {},
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)), Effect.provide(FileSystem.layerNoop({}))),
    )
    await ready
    process.emit("SIGHUP")
    await task

    expect(setup.renderer.isDestroyed).toBe(true)
    expect(titles.at(-1)).toBe("")
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
  let promptRequests = 0
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
    if (url.pathname === "/api/session/dummy/pending") return json({ data: [] })
    if (url.pathname === "/api/session/dummy/permission") return json({ data: [] })
    if (url.pathname === "/api/session/dummy/prompt") {
      promptRequests++
      return json({ data: {} })
    }
  }, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  const originalWrite = process.stdout.write.bind(process.stdout)
  let stdout = ""
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: { get: async () => ({}), update: async () => ({}) },
        packages: { resolve: async () => undefined },
        args: { sessionID: "dummy" },
        log: () => {},
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)), Effect.provide(FileSystem.layerNoop({}))),
    )

    await initialTitleSet
    events.emit({
      id: "evt_renamed",
      created: 1,
      type: "session.renamed",
      durable: { aggregateID: "dummy", seq: 1, version: 1 },
      data: { sessionID: "dummy", title: "Renamed session" },
    })
    await renamedTitleSet
    setup.renderer.destroy()
    await task

    expect(stdout).toContain("Renamed session")
    expect(stdout).toContain("opencode2 -s dummy")
    expect(promptRequests).toBe(0)
  } finally {
    process.stdout.write = originalWrite
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
    mock.restore()
  }
})

test("session startup prompt is submitted exactly once", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventStream()
  const cwd = process.cwd()
  const location = { directory: cwd, project: { id: "project", directory: cwd } }
  const session = {
    id: "dummy",
    title: "Demo session",
    projectID: "project",
    location: { directory: cwd },
    agent: "build",
    model: { providerID: "provider", id: "model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const bodies: unknown[] = []
  const promptSubmitted = Promise.withResolvers<void>()
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/location") return json(location)
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === "/api/session/dummy") return json({ data: session })
    if (url.pathname === "/api/session/dummy/message") return json({ data: [], cursor: {} })
    if (url.pathname === "/api/session/dummy/pending") return json({ data: [] })
    if (url.pathname === "/api/session/dummy/permission") return json({ data: [] })
    if (url.pathname === "/api/agent")
      return json({
        location,
        data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }],
      })
    if (url.pathname === "/api/model")
      return json({
        location,
        data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }],
      })
    if (url.pathname === "/api/session/dummy/prompt") {
      bodies.push(await request.json())
      promptSubmitted.resolve()
      return json({ data: {} })
    }
  }, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: { get: async () => ({}), update: async () => ({}) },
        packages: { resolve: async () => undefined },
        args: { sessionID: "dummy", prompt: "RESUME_READY" },
        log: () => {},
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)), Effect.provide(FileSystem.layerNoop({}))),
    )

    await Promise.race([
      promptSubmitted.promise,
      Bun.sleep(2000).then(() => {
        throw new Error("startup prompt was not submitted")
      }),
    ])
    await Bun.sleep(20)
    setup.renderer.destroy()
    await task

    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ text: "RESUME_READY" })
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
    mock.restore()
  }
})
