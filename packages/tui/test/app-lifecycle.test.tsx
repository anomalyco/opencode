import { afterAll, expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { Renderable, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { resolveAgentSelection, settlePendingAgentSelection } from "../src/context/local"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"

type TestRenderer = Awaited<ReturnType<typeof createTestRenderer>>["renderer"]

const core = await import("@opentui/core")
let activeRenderer: TestRenderer | undefined
mock.module("@opentui/core", () => ({
  ...core,
  createCliRenderer: async () => {
    if (!activeRenderer) throw new Error("test renderer not configured")
    return activeRenderer
  },
}))
const { run } = await import("../src/app")

afterAll(() => mock.restore())

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function findText(root: Renderable, text: string): boolean {
  if (root instanceof TextRenderable && root.plainText === text) return true
  return root.getChildren().some((child) => findText(child, text))
}

async function waitFor(condition: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function providerCatalog() {
  return json({
    providers: [
      {
        id: "test",
        name: "Test",
        env: [],
        models: {
          model: {
            id: "model",
            name: "Model",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {},
      },
    ],
    default: { test: "model" },
  })
}

test("requested agent selection waits for a settled agent list", () => {
  const agents = [{ name: "build" }, { name: "plan" }]
  expect(resolveAgentSelection("loading", [], "plan")).toBe("pending")
  expect(resolveAgentSelection("complete", agents, "plan")).toBe("available")
  expect(resolveAgentSelection("complete", agents, "missing")).toBe("missing")
})

test("missing pending agent emits one warning across repeated settlement", () => {
  let current: string | undefined = "missing"
  let pending = true
  let warningEmissions = 0

  for (let run = 0; run < 2; run++) {
    const settlement = settlePendingAgentSelection("complete", [{ name: "build" }], { current, pending })
    if (!settlement) continue
    current = settlement.current
    pending = settlement.pending
    if (settlement.missing) warningEmissions++
  }

  expect(warningEmissions).toBe(1)
})

test("SIGHUP clears title and disposes scoped resources once", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  activeRenderer = setup.renderer
  const titles: string[] = []
  const setTitle = setup.renderer.setTerminalTitle.bind(setup.renderer)
  setup.renderer.setTerminalTitle = (title) => {
    titles.push(title)
    setTitle(title)
  }
  const listeners = new Set(process.listeners("SIGHUP"))
  const events = createEventSource()
  const calls = createFetch()
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  let disposes = 0

  try {
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: {},
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
    activeRenderer = undefined
  }
})

test("app.exit prints the session epilogue after scoped cleanup", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  activeRenderer = setup.renderer
  const events = createEventSource()
  const calls = createFetch((url) => {
    if (url.pathname === "/session")
      return json([
        {
          id: "dummy",
          title: "Demo session",
          slug: "dummy",
          projectID: "project",
          directory,
          version: "0.0.0-test",
          time: { created: 0, updated: 0 },
        },
      ])
  })
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
    const task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: { continue: true },
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
    await setup.renderOnce()
    await setup.renderOnce()
    api?.keymap.dispatchCommand("app.exit")
    await task

    expect(stdout).toContain("Demo session")
    expect(stdout).toContain("opencode -s dummy")
  } finally {
    process.stdout.write = originalWrite
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    activeRenderer = undefined
  }
})

test("explicit agent is selected after deferred agents load", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  activeRenderer = setup.renderer
  const events = createEventSource()
  const agents = deferred<Response>()
  const calls = createFetch((url) => {
    if (url.pathname === "/agent") return agents.promise
    if (url.pathname === "/config/providers") return providerCatalog()
  })
  let task: Promise<unknown> | undefined
  let disposeSlots: (() => void) | undefined

  try {
    task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: { agent: "plan" },
        pluginHost: {
          async start(input) {
            disposeSlots = input.runtime.setupSlots(input.api).dispose
          },
          async dispose() {
            disposeSlots?.()
          },
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    agents.resolve(
      json([
        { name: "build", mode: "primary", permission: {}, options: {} },
        { name: "plan", mode: "primary", permission: {}, options: {} },
      ]),
    )
    await waitFor(() => findText(setup.renderer.root, "Plan"))
    expect(findText(setup.renderer.root, "Build")).toBe(false)
  } finally {
    try {
      agents.resolve(json([]))
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    } finally {
      try {
        await task
      } finally {
        activeRenderer = undefined
      }
    }
  }
})

test("missing deferred agent warning is visible after loading settles", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  activeRenderer = setup.renderer
  const events = createEventSource()
  const agents = deferred<Response>()
  const calls = createFetch((url) => {
    if (url.pathname === "/agent") return agents.promise
    if (url.pathname === "/config/providers") return providerCatalog()
  })
  const warning = "Agent not found: missing"
  let task: Promise<unknown> | undefined
  let disposeSlots: (() => void) | undefined

  try {
    task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: { agent: "missing" },
        pluginHost: {
          async start(input) {
            disposeSlots = input.runtime.setupSlots(input.api).dispose
          },
          async dispose() {
            disposeSlots?.()
          },
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    agents.resolve(json([{ name: "build", mode: "primary", permission: {}, options: {} }]))
    await waitFor(() => findText(setup.renderer.root, warning))
  } finally {
    try {
      agents.resolve(json([]))
      if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    } finally {
      try {
        await task
      } finally {
        activeRenderer = undefined
      }
    }
  }
})

test("default fast boot starts plugins before the provider catalog settles", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  activeRenderer = setup.renderer
  const events = createEventSource()
  const providers = deferred<Response>()
  const providerRequestStarted = deferred<void>()
  let providerRequestSettled = false
  const calls = createFetch((url) => {
    if (url.pathname !== "/config/providers") return
    providerRequestStarted.resolve()
    return providers.promise.then((response) => {
      providerRequestSettled = true
      return response
    })
  })
  const original = process.env.OPENCODE_NO_FAST_BOOT
  delete process.env.OPENCODE_NO_FAST_BOOT
  let started = false
  let api: TuiPluginApi | undefined
  let task: Promise<unknown> | undefined

  try {
    task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: {},
        pluginHost: {
          async start(input) {
            api = input.api
            started = true
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await providerRequestStarted.promise
    await waitFor(() => started)
    expect(providerRequestSettled).toBe(false)
    expect(api?.state.ready).toBe(false)
    providers.resolve(json({ providers: {}, default: {} }))
    await waitFor(() => providerRequestSettled)
    await waitFor(() => api?.state.ready === true)
  } finally {
    if (original === undefined) delete process.env.OPENCODE_NO_FAST_BOOT
    else process.env.OPENCODE_NO_FAST_BOOT = original
    providers.resolve(json({ providers: {}, default: {} }))
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    try {
      await task
    } finally {
      activeRenderer = undefined
    }
  }
})

test("global loading remains visible until plugins and full sync settle", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  activeRenderer = setup.renderer
  const events = createEventSource()
  const providers = deferred<Response>()
  const plugins = deferred<void>()
  const calls = createFetch((url) => {
    if (url.pathname === "/config/providers") return providers.promise
  })
  const original = process.env.OPENCODE_NO_FAST_BOOT
  delete process.env.OPENCODE_NO_FAST_BOOT
  let started = false
  let task: Promise<unknown> | undefined

  try {
    task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: {},
        pluginHost: {
          start() {
            started = true
            return plugins.promise
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await waitFor(() => started)
    plugins.resolve()
    await Bun.sleep(550)
    await setup.renderOnce()
    expect(findText(setup.renderer.root, "Loading plugins...")).toBe(false)
    expect(findText(setup.renderer.root, "Finishing startup...")).toBe(true)

    providers.resolve(providerCatalog())
    await Bun.sleep(3100)
    await setup.renderOnce()
    expect(findText(setup.renderer.root, "Finishing startup...")).toBe(false)
  } finally {
    if (original === undefined) delete process.env.OPENCODE_NO_FAST_BOOT
    else process.env.OPENCODE_NO_FAST_BOOT = original
    plugins.resolve()
    providers.resolve(providerCatalog())
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    try {
      await task
    } finally {
      activeRenderer = undefined
    }
  }
})

test("fast boot keeps a loading surface visible while plugins start", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  activeRenderer = setup.renderer
  const events = createEventSource()
  const calls = createFetch()
  const plugins = deferred<void>()
  const original = process.env.OPENCODE_NO_FAST_BOOT
  delete process.env.OPENCODE_NO_FAST_BOOT
  let started = false
  let task: Promise<unknown> | undefined

  try {
    task = Effect.runPromise(
      run({
        url: "http://test",
        directory,
        config: createTuiResolvedConfig({ plugin_enabled: {} }),
        fetch: calls.fetch,
        events: events.source,
        args: {},
        pluginHost: {
          start() {
            started = true
            return plugins.promise
          },
          async dispose() {},
        },
      }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
    )

    await waitFor(() => started)
    await Bun.sleep(550)
    await setup.renderOnce()
    expect(findText(setup.renderer.root, "Loading plugins...")).toBe(true)
  } finally {
    if (original === undefined) delete process.env.OPENCODE_NO_FAST_BOOT
    else process.env.OPENCODE_NO_FAST_BOOT = original
    plugins.resolve()
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    try {
      await task
    } finally {
      activeRenderer = undefined
    }
  }
})
