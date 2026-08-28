import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode-ai/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each([70, 120])(
  "/compact renders before model setup, suppresses repeat gestures, and toasts rollback at %i columns",
  async (width) => {
    await using state = await tmpdir()
    const setup = await createTestRenderer({ width, height: 30, useThread: false, kittyKeyboard: true })
    setup.renderer.start()
    const ready = Promise.withResolvers<void>()
    const model = Promise.withResolvers<Response>()
    const events = createEventStream()
    const mutations: string[] = []
    const sessionID = "ses_compact"
    const location = { directory, project: { id: "project", directory, canonical: directory } }
    const calls = createFetch(async (url) => {
      if (url.pathname === `/api/session/${sessionID}`)
        return json({
          data: {
            id: sessionID,
            projectID: "project",
            title: "Compact fixture",
            model: { providerID: "demo", id: "model" },
            location: { directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 0, updated: 0 },
          },
        })
      if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${sessionID}/inbox` || url.pathname === `/api/session/${sessionID}/permission`)
        return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (url.pathname === `/api/session/${sessionID}/model`) {
        mutations.push("model")
        return model.promise
      }
      if (url.pathname === `/api/session/${sessionID}/compact`) {
        mutations.push("compact")
        return json({ data: {} })
      }
      return undefined
    }, events)
    const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: { get: async () => ({ animations: false }), update: async () => ({}) },
        packages: { resolve: async () => undefined },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
        args: { sessionID },
        log: () => {},
      }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
    )
    try {
      await ready.promise
      await setup.waitForFrame((frame) => frame.includes("Demo Model"))
      await setup.mockInput.typeText("/compact")
      setup.mockInput.pressEnter()
      const frame = await setup.waitForFrame((frame) => frame.includes("Compaction queued"))
      expect(frame).not.toContain("/compact")
      await setup.mockInput.typeText("/compact")
      setup.mockInput.pressEnter()
      await setup.renderOnce()
      expect(setup.captureCharFrame().match(/Compaction queued/g)).toHaveLength(1)
      expect(mutations).toEqual(["model"])

      model.resolve(json({ message: "Model setup failed" }, { status: 400 }))
      const rejected = await setup.waitForFrame((frame) => frame.includes("Model setup failed"))
      expect(rejected).not.toContain("Compaction queued")
      expect(mutations).toEqual(["model"])
    } finally {
      model.resolve(new Response(null, { status: 204 }))
      setup.renderer.destroy()
      await task
      await server.stop()
    }
  },
)
