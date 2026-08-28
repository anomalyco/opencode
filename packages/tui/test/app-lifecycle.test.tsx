import { expect, test } from "bun:test"
import { EmbeddedTerminalRenderable, type Renderable, ScrollBoxRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/util/global"
import path from "node:path"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test("SIGHUP clears title and disposes scoped resources once", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
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
        packages: { resolve: async () => ({}), check: async () => ({ mutable: false }) },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
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
  }
})

test("session lifecycle updates the terminal title and prints the epilogue after cleanup", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
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
    if (url.pathname === "/api/session/dummy/inbox") return json({ data: [] })
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
        packages: { resolve: async () => ({}), check: async () => ({ mutable: false }) },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
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
  }
})

test("session title generated while an untitled session is loading remains visible", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const titles: string[] = []
  const setTitle = setup.renderer.setTerminalTitle.bind(setup.renderer)
  const generatedTitle = Promise.withResolvers<void>()
  setup.renderer.setTerminalTitle = (title) => {
    titles.push(title)
    if (title === "OC | Generated title") generatedTitle.resolve()
    setTitle(title)
  }
  const sessionRequested = Promise.withResolvers<void>()
  const renameSyncRequested = Promise.withResolvers<void>()
  const releaseSession = Promise.withResolvers<void>()
  let sessionRequests = 0
  const session = {
    id: "dummy",
    projectID: "project",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const events = createEventStream()
  const calls = createFetch(async (url) => {
    if (url.pathname === "/api/session") return json({ data: [], cursor: {} })
    if (url.pathname === "/api/session/dummy") {
      sessionRequests++
      sessionRequested.resolve()
      if (sessionRequests === 2) renameSyncRequested.resolve()
      await releaseSession.promise
      return json({ data: session })
    }
    if (url.pathname === "/api/session/dummy/message") return json({ data: [], cursor: {} })
    if (url.pathname === "/api/session/dummy/inbox") return json({ data: [] })
    if (url.pathname === "/api/session/dummy/permission") return json({ data: [] })
  }, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: { get: async () => ({}), update: async () => ({}) },
        packages: { resolve: async () => ({}), check: async () => ({ mutable: false }) },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
        args: { sessionID: "dummy" },
        log: () => {},
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)), Effect.provide(FileSystem.layerNoop({}))),
    )

    await sessionRequested.promise
    events.emit({
      id: "evt_renamed",
      created: 1,
      type: "session.renamed",
      durable: { aggregateID: "dummy", seq: 1, version: 1 },
      data: { sessionID: "dummy", title: "Generated title" },
    })
    await Promise.race([
      renameSyncRequested.promise,
      Bun.sleep(2_000).then(() => {
        throw new Error("rename sync did not start")
      }),
    ])
    releaseSession.resolve()
    await Promise.race([
      generatedTitle.promise,
      Bun.sleep(2_000).then(() => {
        throw new Error("generated title was not shown")
      }),
    ])
    await Bun.sleep(20)

    const generated = titles.lastIndexOf("OC | Generated title")
    expect(generated).toBeGreaterThan(-1)
    expect(titles.slice(generated + 1)).not.toContain("OpenCode")
    setup.renderer.destroy()
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
  }
})

test("automatic rename refreshes the displayed title before settling, even without a renamed event", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 90, height: 20, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const events = createEventStream()
  const response = Promise.withResolvers<Response>()
  const bodies: unknown[] = []
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const session = {
    id: "ses_rename",
    title: "Compiler cleanup",
    projectID: "project",
    location: { directory },
    agent: "build",
    model: { providerID: "provider", id: "model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/location") return json(location)
    if (url.pathname === "/api/agent")
      return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
    if (url.pathname === "/api/model")
      return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
    if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
    if (url.pathname === "/api/session") return json({ data: [], cursor: {} })
    if (url.pathname === "/api/session/ses_rename") return json({ data: session })
    if (/^\/api\/session\/ses_rename\/(message|inbox|permission)$/.test(url.pathname))
      return json({ data: [], cursor: {} })
    if (url.pathname === "/api/session/ses_rename/rename") {
      bodies.push(await request.json())
      return response.promise
    }
    return undefined
  }, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: {
          get: async () => ({
            tabs: { enabled: true, layout: "vertical" },
            session: { sidebar: "hide" },
          }),
          update: async () => ({}),
        },
        packages: { resolve: async () => ({}), check: async () => ({ mutable: false }) },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
        args: { sessionID: session.id },
        log: () => {},
      }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
    )

    await setup.waitForFrame((frame) => frame.includes(session.title) && frame.includes("Build · Model Provider"))
    await setup.mockInput.typeText("/rename")
    setup.mockInput.pressEscape()
    setup.mockInput.pressEnter()
    await setup.waitFor(() => bodies.length === 1)
    await setup.renderOnce()
    expect(bodies[0]).toEqual({ title: "" })
    expect(setup.captureCharFrame()).toContain("Compiler cleanup")

    session.title = "Simplify compiler parsing"
    response.resolve(new Response(null, { status: 204 }))
    await setup.waitForFrame((frame) => frame.includes(session.title), { maxPasses: 60 })
    expect(setup.captureCharFrame()).not.toContain("Compiler cleanup")

    setup.renderer.destroy()
    await task
  } finally {
    response.resolve(new Response(null, { status: 204 }))
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
  }
})

test("session startup prompt is submitted exactly once", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
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
    if (url.pathname === "/api/session/dummy/inbox") return json({ data: [] })
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
        packages: { resolve: async () => ({}), check: async () => ({ mutable: false }) },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
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
  }
})

test.each([false, true])("uses the resolved launch directory for new prompts (fallback: %s)", async (fallback) => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const target = fallback ? directory : process.cwd()
  const location = { directory: target, project: { id: "project", directory: target, canonical: target } }
  const requests: URL[] = []
  const created = Promise.withResolvers<unknown>()
  const submitted = Promise.withResolvers<unknown>()
  const ready = Promise.withResolvers<void>()
  const events = createEventStream()
  let session: unknown
  const calls = createFetch(async (url, request) => {
    requests.push(url)
    if (url.searchParams.has("location[directory]") && url.searchParams.get("location[directory]") !== target)
      return json({ message: "Directory does not exist on the server" }, { status: 500 })
    if (url.pathname === "/api/fs/list") return json({ location, data: [] })
    if (url.pathname === "/api/location") return json(location)
    if (url.pathname === "/api/agent")
      return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
    if (url.pathname === "/api/model")
      return json({ location, data: [{ id: "model", providerID: "provider", name: "Remote Model", variants: [] }] })
    if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
    if (url.pathname === "/api/session" && request.method === "POST") {
      const input: unknown = await request.json()
      if (typeof input !== "object" || input === null) throw new Error("Expected a session input")
      created.resolve(input)
      session = {
        ...input,
        projectID: "project",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 0, updated: 0 },
      }
      return json({ data: session })
    }
    if (/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) {
      submitted.resolve(await request.json())
      return json({ data: {} })
    }
    if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname)) return json({ data: [], cursor: {} })
    if (session && /^\/api\/session\/[^/]+$/.test(url.pathname)) return json({ data: session })
    return undefined
  }, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: {
          get: async () => ({ animations: false, tabs: { enabled: false }, keybinds: { "session.new": "f6" } }),
          update: async () => ({}),
        },
        packages: { resolve: async () => ({}), check: async () => ({ mutable: false }) },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
        args: {},
        log: () => {},
      }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
    )

    await ready.promise
    await setup.waitForFrame((frame) => frame.includes("Build · Remote Model Provider"))
    setup.mockInput.pressKey("F6")
    await setup.renderOnce()
    await setup.mockInput.typeText("REMOTE_READY")
    await setup.waitForFrame((frame) => frame.includes("REMOTE_READY"))
    setup.mockInput.pressEnter()
    expect(
      await Promise.race([
        submitted.promise,
        Bun.sleep(2_000).then(() => {
          throw new Error("prompt was not submitted in the resolved server directory")
        }),
      ]),
    ).toMatchObject({ text: "REMOTE_READY" })
    expect(await created.promise).toMatchObject({ location: { directory: target } })
    expect(requests[0]?.pathname).toBe("/api/fs/list")
    expect(requests[0]?.searchParams.get("location[directory]")).toBe(process.cwd())
    expect(
      requests.filter((url) => url.pathname === "/api/location" && !url.searchParams.has("location[directory]")),
    ).toHaveLength(fallback ? 1 : 0)
    expect(
      requests
        .slice(1)
        .filter((url) => url.searchParams.has("location[directory]"))
        .every((url) => url.searchParams.get("location[directory]") === target),
    ).toBe(true)
    setup.renderer.destroy()
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
  }
})

test("error investigations repeatedly seed editable home drafts without creating sessions", async () => {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const events = createEventStream()
  const cwd = process.cwd()
  const location = { directory: cwd, project: { id: "project", directory: cwd } }
  let created = 0
  const calls = createFetch((url, request) => {
    if (url.pathname === "/api/location") return json(location)
    if (url.pathname === "/api/mcp")
      return json({
        location,
        data: [
          { name: "alpha", status: { status: "failed", error: "Alpha connection refused" } },
          { name: "beta", status: { status: "failed", error: "Beta initialization failed" } },
        ],
      })
    if (url.pathname === "/api/session" && request.method === "POST") created++
    return undefined
  }, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: {
          get: async () => ({ animations: false, keybinds: { "mcp.list": "f6" } }),
          update: async () => ({}),
        },
        packages: { resolve: async () => ({}), check: async () => ({ mutable: false }) },
        args: {},
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
        log: () => {},
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)), Effect.provide(FileSystem.layerNoop({}))),
    )
    await setup.waitForFrame((frame) => frame.includes("commands"))

    setup.mockInput.pressKey("F6")
    await setup.waitForFrame((frame) => frame.includes("MCP servers") && frame.includes("alpha"))
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Alpha connection refused") && frame.includes("i investigate"))
    setup.mockInput.pressKey("i")
    await setup.waitForFrame((frame) => frame.includes("Alpha connection refused") && !frame.includes("i investigate"))

    setup.mockInput.pressKey("F6")
    await setup.waitForFrame((frame) => frame.includes("MCP servers"))
    setup.mockInput.pressArrow("down")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((frame) => frame.includes("Beta initialization failed") && frame.includes("i investigate"))
    setup.mockInput.pressKey("i")
    const draft = await setup.waitForFrame(
      (frame) => frame.includes("Beta initialization failed") && !frame.includes("i investigate"),
    )

    expect(draft).not.toContain("Alpha connection refused")
    expect(created).toBe(0)

    setup.mockInput.pressKey("c", { ctrl: true })
    await setup.waitForFrame((frame) => !frame.includes("Beta initialization failed"))
    setup.renderer.destroy()
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
  }
})

test("shows jump to latest after scrolling one line above the final message", async () => {
  const setup = await createTestRenderer({ width: 80, height: 20, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const events = createEventStream()
  const session = {
    id: "dummy",
    title: "Demo session",
    projectID: "project",
    location: { directory },
    agent: "build",
    model: { providerID: "provider", id: "model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const messages = Array.from({ length: 8 }, (_, index) => ({
    id: `message-${index}`,
    type: "user",
    text: index === 7 ? "Final visible message" : `Earlier message ${index}`,
    time: { created: index },
  }))
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === "/api/session/dummy") return json({ data: session })
    if (url.pathname === "/api/session/dummy/message") return json({ data: messages.toReversed(), cursor: {} })
    if (url.pathname === "/api/session/dummy/inbox") return json({ data: [] })
    if (url.pathname === "/api/session/dummy/permission") return json({ data: [] })
  }, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: {
          get: async () => ({
            animations: false,
            keybinds: { "session.line.up": "f6", "session.line.down": "f7" },
          }),
          update: async () => ({}),
        },
        packages: { resolve: async () => ({}), check: async () => ({ mutable: false }) },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
        args: { sessionID: "dummy" },
        log: () => {},
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)), Effect.provide(FileSystem.layerNoop({}))),
    )

    await setup.waitForFrame((frame) => frame.includes("Final visible message"))
    const findScrollBox = (root: Renderable): ScrollBoxRenderable | undefined =>
      root instanceof ScrollBoxRenderable && root.getRenderable("message-7")
        ? root
        : root.getChildren().map(findScrollBox).find(Boolean)
    const scroll = findScrollBox(setup.renderer.root)
    expect(scroll).toBeDefined()
    if (!scroll) throw new Error("session transcript scrollbox was not found")
    const maximum = () => Math.max(0, scroll.scrollHeight - scroll.viewport.height)

    expect(scroll.scrollTop).toBe(maximum())
    const initial = setup.captureCharFrame().split("\n")
    expect(initial.find((line) => line.includes("Jump to latest"))).toBeUndefined()
    expect(initial[initial.findIndex((line) => line.includes("Final visible message")) + 1]).toContain("┃")

    setup.mockInput.pressKey("F6")
    const clipped = (await setup.waitForFrame((frame) => frame.includes("Jump to latest"))).split("\n")
    expect(scroll.scrollTop).toBe(maximum() - 1)
    expect(clipped.find((line) => line.includes("Jump to latest"))).toBeDefined()
    expect(clipped[clipped.findIndex((line) => line.includes("Final visible message")) + 1]).not.toContain("┃")

    setup.mockInput.pressKey("F7")
    const restored = (await setup.waitForFrame((frame) => !frame.includes("Jump to latest"))).split("\n")
    expect(scroll.scrollTop).toBe(maximum())
    expect(restored.find((line) => line.includes("Jump to latest"))).toBeUndefined()
    expect(restored[restored.findIndex((line) => line.includes("Final visible message")) + 1]).toContain("┃")

    setup.renderer.destroy()
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
  }
})

test("new session inherits the active session model", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const events = createEventStream()
  const cwd = process.cwd()
  const location = { directory: cwd, project: { id: "project", directory: cwd } }
  const session = {
    id: "dummy",
    title: "Demo session",
    projectID: "project",
    location: { directory: cwd },
    agent: "build",
    model: { providerID: "provider", id: "session-model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/fs/list") return json({ location, data: [] })
    if (url.pathname === "/api/location") return json(location)
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === "/api/session/dummy") return json({ data: session })
    if (url.pathname === "/api/session/dummy/message") return json({ data: [], cursor: {} })
    if (url.pathname === "/api/session/dummy/inbox") return json({ data: [] })
    if (url.pathname === "/api/session/dummy/permission") return json({ data: [] })
    if (url.pathname === "/api/agent")
      return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
    if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
    if (url.pathname === "/api/model")
      return json({
        location,
        data: [
          { id: "home-model", providerID: "provider", name: "Home Model", variants: [] },
          { id: "session-model", providerID: "provider", name: "Session Model", variants: [] },
        ],
      })
  }, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: { get: async () => ({ animations: false }), update: async () => ({}) },
        packages: { resolve: async () => ({}), check: async () => ({ mutable: false }) },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
        args: { sessionID: "dummy" },
        log: () => {},
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)), Effect.provide(FileSystem.layerNoop({}))),
    )

    await setup.waitForFrame((frame) => frame.includes("Session Model"))
    await setup.mockInput.typeText("/new")
    setup.mockInput.pressEnter()
    await Bun.sleep(50)
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("Session Model")
    setup.renderer.destroy()
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
  }
})

test("keeps the prompt display stable while a new location catalog loads", async () => {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const events = createEventStream()
  const source = process.cwd()
  const target = path.join(path.parse(source).root, "opencode-target")
  const locationCatalog = Promise.withResolvers<void>()
  const catalog = Promise.withResolvers<void>()
  const providerCatalog = Promise.withResolvers<void>()
  const locationRequested = Promise.withResolvers<void>()
  const modelRequested = Promise.withResolvers<void>()
  const ready = Promise.withResolvers<void>()
  const calls = createFetch(async (url) => {
    const requestedDirectory = url.searchParams.get("location[directory]") ?? source
    const location = {
      directory: requestedDirectory,
      project: {
        id: requestedDirectory === target ? "target" : "source",
        directory: requestedDirectory,
        canonical: requestedDirectory,
      },
    }
    if (url.pathname === "/api/location") {
      if (requestedDirectory === target) {
        locationRequested.resolve()
        await locationCatalog.promise
      }
      return json(location)
    }
    if (url.pathname === "/api/agent") {
      if (requestedDirectory === target) await catalog.promise
      return json({
        location,
        data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }],
      })
    }
    if (url.pathname === "/api/provider") {
      if (requestedDirectory === target) await providerCatalog.promise
      return json({ location, data: [{ id: "provider", name: "Provider" }] })
    }
    if (url.pathname === "/api/model") {
      if (requestedDirectory === target) {
        modelRequested.resolve()
        await catalog.promise
      }
      return json({
        location,
        data: [
          {
            id: requestedDirectory === target ? "target-model" : "source-model",
            providerID: "provider",
            name: requestedDirectory === target ? "Target Model" : "Source Model",
            variants: [],
          },
        ],
      })
    }
    return undefined
  }, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: { get: async () => ({ animations: false }), update: async () => ({}) },
        packages: { resolve: async () => ({}), check: async () => ({ mutable: false }) },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
        args: {},
        log: () => {},
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)), Effect.provide(FileSystem.layerNoop({}))),
    )

    await ready.promise
    await setup.waitForFrame((frame) => frame.includes("Build · Source Model Provider"))
    const agentSpan = () =>
      setup
        .captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.trim() === "Build")
    const sourceAgentColor = agentSpan()?.fg.toInts()
    expect(sourceAgentColor).toBeDefined()
    await setup.mockInput.typeText(`/cd ${target}`)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain(`/cd ${target}`)
    setup.mockInput.pressEscape()
    setup.mockInput.pressEnter()
    await Promise.race([
      locationRequested.promise,
      Bun.sleep(2_000).then(() => {
        throw new Error("target location was not requested")
      }),
    ])
    await setup.renderOnce()
    expect(setup.captureCharFrame()).toContain(target)

    locationCatalog.resolve()
    await Promise.race([
      modelRequested.promise,
      Bun.sleep(2_000).then(() => {
        throw new Error("target model catalog was not requested")
      }),
    ])
    await setup.renderOnce()

    expect(setup.captureCharFrame()).toContain("Build · Source Model Provider")
    expect(agentSpan()?.fg.toInts()).toEqual(sourceAgentColor)

    catalog.resolve()
    const resolved = await setup.waitForFrame((frame) => frame.includes("Build · Target Model provider"))
    expect(resolved).not.toContain("Source Model")

    providerCatalog.resolve()
    await setup.waitForFrame((frame) => frame.includes("Build · Target Model Provider"))

    setup.renderer.destroy()
    await task
  } finally {
    locationCatalog.resolve()
    catalog.resolve()
    providerCatalog.resolve()
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
  }
})

test("configured app bindings execute settings and permission commands", async () => {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const ready = Promise.withResolvers<void>()
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: {
          get: async () => ({
            animations: false,
            keybinds: { "opencode.settings": "f6", "permission.mode": "f7" },
          }),
          update: async () => ({}),
        },
        packages: { resolve: async () => ({}), check: async () => ({ mutable: false }) },
        args: {},
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
        log: () => {},
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)), Effect.provide(FileSystem.layerNoop({}))),
    )
    await ready.promise
    await setup.waitForFrame((frame) => frame.includes("commands"))

    setup.mockInput.pressKey("F6")
    const settings = await setup.waitForFrame((frame) => frame.includes("Settings"))
    expect(settings).toContain("Color mode")
    expect(settings).toContain("Animations")

    setup.mockInput.pressEscape()
    await setup.waitForFrame((frame) => !frame.includes("Settings"))
    setup.mockInput.pressKey("F7")
    await setup.renderOnce()
    setup.mockInput.pressKey("p", { ctrl: true })
    await setup.waitForFrame((frame) => frame.includes("Commands"))
    setup.mockInput.pressKey("END")
    const commands = await setup.waitForFrame(
      (frame) => {
        if (frame.includes("Disable auto-approve permissions")) return true
        setup.mockInput.pressArrow("up")
        return false
      },
      { maxPasses: 100 },
    )
    expect(commands).not.toContain("Enable auto-approve permissions")

    setup.renderer.destroy()
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
  }
})

test("ctrl+c dismisses autocomplete and shell mode before exiting", async () => {
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const ready = Promise.withResolvers<void>()
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })

  try {
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: { get: async () => ({ animations: false }), update: async () => ({}) },
        packages: { resolve: async () => ({}), check: async () => ({ mutable: false }) },
        args: {},
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
        log: () => {},
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)), Effect.provide(FileSystem.layerNoop({}))),
    )

    await ready.promise
    await setup.waitForFrame((frame) => frame.includes("commands"))
    await setup.mockInput.typeText("/theme")
    await setup.waitForFrame((frame) => frame.includes("Switch theme"))

    setup.mockInput.pressKey("c", { ctrl: true })
    await setup.waitForFrame((frame) => !frame.includes("Switch theme"))
    expect(setup.renderer.isDestroyed).toBe(false)

    await setup.mockInput.typeText("!")
    await setup.waitForFrame((frame) => frame.includes("Shell"))
    setup.mockInput.pressKey("c", { ctrl: true })
    await setup.waitForFrame((frame) => !frame.includes("Shell"))
    expect(setup.renderer.isDestroyed).toBe(false)

    setup.renderer.destroy()
    await task
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await server.stop()
  }
})

test.each(["manual", "select"] as const)(
  "selection copy and dismissal respect %s mode in the prompt and terminal pane",
  async (copy) => {
    const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
    setup.renderer.start()
    const ready = Promise.withResolvers<void>()
    const session = {
      id: "dummy",
      title: "Selection fixture",
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
    const input: string[] = []
    const calls = createFetch((url, request) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === "/api/session/dummy") return json({ data: session })
      if (url.pathname === "/api/session/dummy/message") return json({ data: [], cursor: {} })
      if (url.pathname === "/api/session/dummy/inbox") return json({ data: [] })
      if (url.pathname === "/api/session/dummy/permission") return json({ data: [] })
      if (url.pathname === "/api/experimental/session/dummy/terminal")
        return json({ data: request.method === "POST" ? pty : [pty] })
      if (url.pathname === "/api/experimental/persistent-pty/pty_fixture/snapshot")
        return json({
          data: {
            info: pty,
            text: "alpha beta gamma",
            checkpoint: Buffer.from("alpha beta gamma").toString("base64"),
            cursor: { x: 16, y: 0 },
          },
        })
      if (url.pathname === "/api/experimental/persistent-pty/pty_fixture/connect-token")
        return json({ data: { ticket: "fixture" } })
      return undefined
    }, createEventStream())
    const server = Bun.serve({
      port: 0,
      fetch(request, server) {
        if (new URL(request.url).pathname.endsWith("/connect") && server.upgrade(request)) return undefined
        return calls.fetch(request)
      },
      websocket: {
        open(socket) {
          socket.send(JSON.stringify({ type: "attached", inputProtocol: 1, role: "controller", info: pty }))
          socket.send(JSON.stringify({ type: "replay_complete" }))
        },
        message(_socket, message) {
          const data = Buffer.from(message)
          if (data[0] === 1) input.push(data.subarray(5).toString())
        },
      },
    })

    try {
      const { run } = await import("../src/app")
      const task = Effect.runPromise(
        run({
          app: { name: "test", version: "test", channel: "test" },
          server: { endpoint: { url: server.url.toString() } },
          config: {
            get: async () => ({
              animations: false,
              terminal: { copy },
              session: { terminal: true },
            }),
            update: async () => ({}),
          },
          packages: { resolve: async () => ({}), check: async () => ({ mutable: false }) },
          args: { sessionID: session.id },
          terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
          log: () => {},
        }).pipe(Effect.provide(AppNodeBuilder.build(Global.node)), Effect.provide(FileSystem.layerNoop({}))),
      )

      await ready.promise
      await setup.waitForFrame((frame) => frame.includes("commands"))
      await setup.mockInput.typeText("selection audit draft")
      setup.mockInput.pressKey("a", { ctrl: true, shift: true })
      expect(setup.renderer.getSelection()?.getSelectedText()).toBe("selection audit draft")

      setup.mockInput.pressEscape()
      expect(setup.renderer.hasSelection).toBeFalse()
      expect(setup.renderer.currentFocusedEditor?.plainText).toBe("selection audit draft")

      setup.mockInput.pressKey("c", { ctrl: true })
      await setup.waitForFrame((frame) => !frame.includes("selection audit draft"))
      expect(setup.renderer.currentFocusedEditor?.plainText).toBe("")
      expect(setup.renderer.hasSelection).toBeFalse()
      expect(setup.renderer.isDestroyed).toBeFalse()

      await setup.mockInput.typeText("/terminal")
      await setup.waitForFrame((frame) => frame.includes("New terminal"))
      setup.mockInput.pressEnter()
      await setup.waitForFrame((frame) => frame.includes("alpha beta gamma"))
      setup.mockInput.pressKey("x", { ctrl: true })
      setup.mockInput.pressArrow("right")
      const terminal = setup.renderer.currentFocusedRenderable
      if (!(terminal instanceof EmbeddedTerminalRenderable)) throw new Error("Terminal was not focused")
      setup.renderer.startSelection(terminal, terminal.x + 6, terminal.y)
      setup.renderer.updateSelection(terminal, terminal.x + 9, terminal.y, { finishDragging: true })
      expect(setup.renderer.getSelection()?.getSelectedText()).toBe("beta")

      setup.mockInput.pressEscape()
      expect(setup.renderer.hasSelection).toBeFalse()
      expect(terminal.hasSelection()).toBeFalse()

      await setup.mockMouse.click(terminal.x + 6, terminal.y)
      if (copy === "select") {
        setup.renderer.updateSelection(terminal, terminal.x + 9, terminal.y, { finishDragging: true })
        expect(setup.renderer.getSelection()?.getSelectedText()).toBe("beta")
      }
      setup.mockInput.pressKey("c", { ctrl: true })
      await setup.waitFor(() => input.length > 0)
      expect(input).toEqual(["\x03"])
      expect(setup.renderer.hasSelection).toBeFalse()
      expect(setup.renderer.isDestroyed).toBeFalse()

      setup.renderer.destroy()
      await task
    } finally {
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
      await server.stop()
    }
  },
)
