import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { InputRenderable } from "@opentui/core"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode-ai/util/global"
import { createEventStream, createFetch, directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

test.each(["all", "connected", "connect"])(
  "%s model picker keeps release order before and after searching",
  async (entry) => {
    await using state = await tmpdir()
    const setup = await createTestRenderer({ width: 110, height: 40, useThread: false, kittyKeyboard: true })
    setup.renderer.start()
    const ready = Promise.withResolvers<void>()
    const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
    let connected = entry === "connected"
    const calls = createFetch((url) => {
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider")
        return json({
          location,
          data: [
            { id: "demo", name: "Demo" },
            { id: "other", name: "Other" },
          ],
        })
      if (url.pathname === "/api/integration")
        return json({
          location,
          data: [
            {
              id: "demo",
              name: "Demo",
              methods: [{ type: "key" }],
              connections: connected ? [{ type: "credential", id: "cred_demo", label: "Demo" }] : [],
            },
          ],
        })
      if (url.pathname === "/api/integration/demo/connect/key") {
        connected = true
        return new Response(null, { status: 204 })
      }
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [
            {
              id: "haiku-other",
              providerID: "other",
              name: "Other Haiku",
              enabled: true,
              variants: [],
              cost: [],
              time: { released: 0 },
            },
            ...[
              { id: "haiku-3", name: "Claude Haiku 3", released: 1 },
              { id: "haiku-4-5", name: "Claude Haiku 4.5", released: 2 },
            ].map((model) => ({
              id: model.id,
              providerID: "demo",
              name: model.name,
              enabled: true,
              variants: [],
              cost: [],
              time: { released: model.released },
            })),
          ],
        })
      return undefined
    }, createEventStream())
    const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
    const { run } = await import("../src/app")
    const task = Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: { get: async () => ({ animations: false }), update: async () => ({}) },
        packages: { prepare: async () => ({ directory: "" }) },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
        args: {},
        log: () => {},
      }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
    )
    try {
      await ready.promise
      await setup.waitForFrame((frame) => frame.includes("Build ·"))
      await setup.mockInput.typeText("/models")
      setup.mockInput.pressEnter()
      await setup.waitForFrame(
        (frame) => frame.includes("Select model") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
      )
      if (entry === "connect") {
        setup.mockInput.pressKey("a", { ctrl: true })
        await setup.waitForFrame((frame) => frame.includes("Connect an integration") && frame.includes("Services"))
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => frame.includes("API key"))
        await setup.mockInput.typeText("fixture-key")
        setup.mockInput.pressEnter()
        await setup.waitForFrame((frame) => frame.includes("Connected Demo") && frame.includes("Claude Haiku 4.5"))
        expect(setup.captureCharFrame().split("Connect an integration")[0]).not.toContain("Other Haiku")
      }
      const initial = setup.captureCharFrame()
      expect(initial.indexOf("Claude Haiku 4.5")).toBeLessThan(initial.indexOf("Claude Haiku 3"))
      await setup.mockInput.typeText("haik")
      const frame = await setup.waitForFrame((frame) => frame.includes("haik") && frame.includes("Claude Haiku 3"))
      expect(frame.indexOf("Claude Haiku 4.5")).toBeLessThan(frame.indexOf("Claude Haiku 3"))
      setup.mockInput.pressKey("u", { ctrl: true })
      await setup.waitForFrame((frame) => !frame.includes("haik"))
      expect(setup.captureCharFrame().indexOf("Claude Haiku 4.5")).toBeLessThan(
        setup.captureCharFrame().indexOf("Claude Haiku 3"),
      )
      await setup.mockInput.typeText("no-such-model")
      await setup.waitForFrame((frame) => frame.includes("No results found"))
      setup.mockInput.pressKey("u", { ctrl: true })
      await setup.mockInput.typeText("haik")
      await setup.waitForFrame((frame) => frame.includes("haik") && frame.includes("Claude Haiku 4.5"))
      setup.mockInput.pressEnter()
      await setup.waitForFrame(
        (frame) =>
          !frame.includes("Select model") &&
          !frame.includes("Connect an integration") &&
          frame.includes("Build · Claude Haiku 4.5"),
      )
    } finally {
      setup.renderer.destroy()
      await task
      await server.stop()
    }
  },
)
