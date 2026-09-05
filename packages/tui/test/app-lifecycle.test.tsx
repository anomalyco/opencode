import { expect, mock, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"

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
  const events = createEventSource()
  const calls = createFetch()
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  let disposes = 0

  try {
    const { run } = await import("../src/app")
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
    mock.restore()
  }
})

test("app.exit prints the session epilogue after scoped cleanup", async () => {
  // FAST_BOOT mounts the session route before the continue effect resolves
  // the real id, mirroring how the app runs in practice. Saved/restored so
  // the env never leaks across test files.
  const ORIGINAL_FAST_BOOT = process.env.OPENCODE_FAST_BOOT
  process.env.OPENCODE_FAST_BOOT = "1"
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => setup.renderer }))
  const events = createEventSource()
  const requested: string[] = []
  const demoSession = {
    id: "ses_demo",
    title: "Demo session",
    slug: "ses_demo",
    projectID: "project",
    directory,
    version: "0.0.0-test",
    time: { created: 0, updated: 0 },
  }
  const calls = createFetch((url) => {
    requested.push(url.pathname)
    // Delay the session list so the mounted session route fires its eager
    // fetch before the continue effect navigates. With the placeholder bug
    // this produces /session/dummy* requests; with the fix it cannot.
    if (url.pathname === "/session") {
      return new Promise((resolve) => setTimeout(() => resolve(json([demoSession])), 50))
    }
    if (url.pathname === "/session/ses_demo") return json(demoSession)
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
    const { run } = await import("../src/app")
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
    // Poll until the session route fetched the real id, so the test never
    // races the 50ms mock delay.
    for (let waited = 0; !requested.includes("/session/ses_demo") && waited < 2000; waited += 20) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    api?.keymap.dispatchCommand("app.exit")
    await task

    expect(stdout).toContain("Demo session")
    expect(stdout).toContain("opencode -s ses_demo")
    // Regression: --continue must never fetch a placeholder session id.
    // The server rejects ids without the "ses" prefix (400), which the
    // session route surfaces as an error toast. Every /session/:id request
    // after the list itself must carry the resolved, valid id.
    expect(requested).not.toContain("/session/dummy")
    expect(requested).toContain("/session/ses_demo")
    const fetchedIds = requested
      .filter((p) => p.startsWith("/session/") && p !== "/session" && p !== "/session/status")
      .map((p) => p.split("/")[2])
    expect(fetchedIds.length).toBeGreaterThan(0)
    expect(fetchedIds.every((id) => id === "ses_demo")).toBe(true)
  } finally {
    process.stdout.write = originalWrite
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    mock.restore()
    if (ORIGINAL_FAST_BOOT === undefined) delete process.env.OPENCODE_FAST_BOOT
    else process.env.OPENCODE_FAST_BOOT = ORIGINAL_FAST_BOOT
  }
})
