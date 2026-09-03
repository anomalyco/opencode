import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Global } from "@opencode-ai/util/global"
import { Effect, FileSystem } from "effect"
import { createEventStream, createFetch, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test("stats shows only this year and returns after errors or success", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 34, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const requests: URL[] = []
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/session/stats") return undefined
    requests.push(url)
    if (requests.length === 1) return json({ message: "offline" }, { status: 503 })
    return json({
      data: {
        range: { from: new Date(new Date().getFullYear(), 0, 1).getTime(), to: Date.now() },
        sessions: 123,
        subagents: 0,
        prompts: 1,
        steps: 1,
        tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 20, write: 0 } },
        cost: 0,
        tools: { mode: "none" },
        activeDays: 1,
        streak: 1,
        activity: [{ date: `${new Date().getFullYear()}-01-01`, steps: 1 }],
        models: [],
      },
    })
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { enabled: false } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      args: {},
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitForFrame((frame) => frame.includes("commands"))
    await setup.mockInput.typeText("/stats")
    await setup.waitForFrame((frame) => frame.includes("Usage statistics"))
    setup.mockInput.pressKey("RETURN")
    await setup.waitForFrame((frame) => frame.includes("Could not load stats"))
    setup.mockInput.pressKey("ESCAPE")
    await setup.waitForFrame((frame) => frame.includes("commands") && !frame.includes("Could not load stats"))
    await setup.mockInput.typeText("/stats")
    await setup.waitForFrame((frame) => frame.includes("Usage statistics"))
    setup.mockInput.pressKey("RETURN")
    await setup.waitForFrame((frame) => frame.includes("TOKENS") && frame.includes("123"))
    expect(requests[1].searchParams.get("tools")).toBe("none")
    expect(Number(requests[1].searchParams.get("from"))).toBe(new Date(new Date().getFullYear(), 0, 1).getTime())
    expect(requests[1].searchParams.has("to")).toBe(false)
    expect(setup.captureCharFrame()).not.toContain("all time")
    expect(setup.captureCharFrame()).not.toContain("All projects")
    expect(setup.captureCharFrame()).not.toContain("show this year")
    expect(setup.captureCharFrame()).not.toContain("esc")
    expect(
      setup
        .captureCharFrame()
        .split("\n")
        .find((line) => line.includes("opencode / stats")),
    ).not.toContain("tab")
    setup.mockInput.pressKey("RETURN")
    setup.mockInput.pressKey("SPACE")
    await setup.mockInput.typeText("rhp")
    setup.mockInput.pressKey("TAB")
    setup.mockInput.pressKey("RIGHT")
    await setup.waitForVisualIdle()
    expect(requests).toHaveLength(2)
    expect(setup.captureCharFrame()).toContain("TOKENS")
    expect(setup.captureCharFrame()).not.toContain("headline")
    setup.mockInput.pressKey("ESCAPE")
    await setup.waitForFrame((frame) => frame.includes("commands") && !frame.includes("opencode / stats"))
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await task.finally(() => server.stop(true))
  }
})
