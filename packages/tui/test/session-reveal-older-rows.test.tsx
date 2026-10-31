import { expect, test } from "bun:test"
import { ScrollBoxRenderable, type Renderable } from "@opentui/core"
import { createTestRenderer, TestRecorder } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test("revealing older rows keeps the viewport in place on every frame", async () => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const session = {
    id: "ses_reveal",
    title: "Reveal",
    projectID: "proj_test",
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  // More rows than the mounted tail, so scrolling up mounts an older chunk above the viewport.
  const messages = Array.from({ length: 200 }, (_, index) => ({
    id: `message-${index}`,
    type: "user",
    text: `User message ${index}`,
    time: { created: index },
  }))
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox` || url.pathname === `/api/session/${session.id}/permission`)
      return json({ data: [] })
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: { get: async () => ({ animations: false, tabs: { enabled: false } }), update: async () => ({}) },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitForFrame((frame) => frame.includes("User message 199"))
    await setup.waitForVisualIdle()
    const find = (root: Renderable): ScrollBoxRenderable | undefined =>
      root instanceof ScrollBoxRenderable && root.getRenderable("message-199")
        ? root
        : root.getChildren().map(find).find(Boolean)
    const scroll = find(setup.renderer.root)
    if (!scroll) throw new Error("Session scrollbox not found")
    const recorder = new TestRecorder(setup.renderer)
    recorder.rec()
    for (let step = 0; step < 80; step++) {
      await setup.mockMouse.scroll(scroll.viewport.x + 5, scroll.viewport.y + 5, "up")
      await setup.renderOnce()
    }
    await setup.waitForVisualIdle()
    recorder.stop()
    const tops = recorder.recordedFrames.map((recorded) =>
      Math.min(...[...recorded.frame.matchAll(/User message (\d+)/g)].map((match) => Number(match[1]))),
    )
    // The test scrolls far enough to mount at least one older chunk.
    expect(tops.at(-1)).toBeLessThan(160)
    // Each wheel step moves the viewport by a few rows; a prepend must never show a distant row first.
    const jumps = tops.flatMap((top, index) => (index > 0 && Math.abs(top - tops[index - 1]) > 2 ? [index] : []))
    expect(jumps).toEqual([])
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
})
