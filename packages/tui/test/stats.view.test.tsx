import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Global } from "@opencode-ai/util/global"
import { Effect, FileSystem } from "effect"
import { statsFixture } from "../src/feature-plugins/system/storybook/stats"
import { createEventStream, createFetch, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test("stats retries failures, freezes presentation, and returns to the original route", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 34, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const requests: URL[] = []
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/session/stats") return undefined
    requests.push(url)
    if (requests.length === 1) return json({ message: "offline" }, { status: 503 })
    return json({ data: statsFixture })
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
      packages: { resolve: async () => undefined },
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
    await setup.mockInput.typeText("r")
    await setup.waitForFrame((frame) => frame.includes("TOKENS") && frame.includes("All projects"))
    expect(requests[1].searchParams.get("tools")).toBe("none")
    await setup.mockInput.typeText("h")
    await setup.waitForFrame((frame) => frame.includes("DAY BEST STREAK"))
    expect(setup.captureCharFrame()).toContain("9.2B")
    await setup.mockInput.typeText("p")
    await setup.waitForFrame((frame) => !frame.includes("p present"))
    await setup.mockInput.typeText("rh")
    setup.mockInput.pressKey("RIGHT")
    await setup.waitForVisualIdle()
    expect(requests).toHaveLength(2)
    expect(setup.captureCharFrame()).toContain("DAY BEST STREAK")
    setup.mockInput.pressKey("ESCAPE")
    await setup.waitForFrame((frame) => frame.includes("p present"))
    setup.mockInput.pressKey("ESCAPE")
    await setup.waitForFrame((frame) => frame.includes("commands") && !frame.includes("opencode / stats"))
  } finally {
    if (!setup.renderer.isDestroyed) setup.renderer.destroy()
    await task.finally(() => server.stop(true))
  }
})
