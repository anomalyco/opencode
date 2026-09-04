import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { InputRenderable } from "@opentui/core"
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
    const modelRequested = Promise.withResolvers<void>()
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
        modelRequested.resolve()
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
        packages: { prepare: async () => ({ directory: "" }) },
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
      await modelRequested.promise
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

test.each(["first", "second"])(
  "a following prompt commits its selected model after prompt and compaction setup (cached: %s)",
  async (initial) => {
    await using state = await tmpdir()
    const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
    setup.renderer.start()
    const ready = Promise.withResolvers<void>()
    const first = Promise.withResolvers<void>()
    const firstRequested = Promise.withResolvers<void>()
    const secondRequested = Promise.withResolvers<string>()
    const events = createEventStream()
    const sessionID = "ses_model_order"
    const location = { directory, project: { id: "project", directory, canonical: directory } }
    const session = {
      id: sessionID,
      projectID: "project",
      title: "Model ordering fixture",
      agent: "build",
      model: { providerID: "demo", id: initial },
      location: { directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 0, updated: 0 },
    }
    const mutations: string[] = []
    const calls = createFetch(async (url, request) => {
      if (url.pathname === `/api/session/${sessionID}`) return json({ data: session })
      if (url.pathname === `/api/session/${sessionID}/message`) return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${sessionID}/inbox` || url.pathname === `/api/session/${sessionID}/permission`)
        return json({ data: [] })
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: ["first", "second"].map((id) => ({
            id,
            providerID: "demo",
            name: `${id} model`,
            variants: [],
            cost: [],
            time: { released: 0 },
          })),
        })
      if (url.pathname === `/api/session/${sessionID}/model`) {
        session.model = (await request.json()).model
        mutations.push(`model:${session.model.id}`)
        // Delay SSE so local selection must not rely on the cached server model.
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${sessionID}/compact`) {
        mutations.push(`compact:${session.model.id}`)
        return json({
          data: {
            id: (await request.json()).id,
            sessionID,
            type: "compaction",
            timeCreated: 10,
            payload: {},
            delivery: "steer",
          },
        })
      }
      if (url.pathname === `/api/session/${sessionID}/prompt`) {
        const body = await request.json()
        mutations.push(`prompt:${body.text}:${session.model.id}`)
        if (body.text === "First prompt") {
          firstRequested.resolve()
          await first.promise
        }
        if (body.text === "Second prompt") secondRequested.resolve(session.model.id)
        return json({
          data: {
            id: body.id,
            sessionID,
            type: "user",
            timeCreated: 10,
            payload: { text: body.text },
            delivery: "steer",
          },
        })
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
        packages: { prepare: async () => ({ directory: "" }) },
        terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: ready.resolve }),
        args: { sessionID },
        log: () => {},
      }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
    )
    const selectModel = async (id: string) => {
      await setup.mockInput.typeText("/models")
      setup.mockInput.pressEnter()
      await setup.waitForFrame(
        (frame) => frame.includes("Select model") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
      )
      await setup.mockInput.typeText(id)
      await setup.renderOnce()
      setup.mockInput.pressEnter()
      await setup.waitForFrame((frame) => frame.includes(`${id} model`) && !frame.includes("Select model"))
    }
    try {
      await ready.promise
      await setup.waitForFrame((frame) => frame.includes(`${initial} model`))
      await setup.mockInput.typeText("First prompt")
      setup.mockInput.pressEnter()
      await firstRequested.promise
      const submitted = mutations.length
      if (initial !== "first") await selectModel("first")
      await setup.mockInput.typeText("/compact")
      setup.mockInput.pressEnter()
      await setup.waitForFrame((frame) => frame.includes("Compaction queued"))
      await selectModel("second")
      await setup.mockInput.typeText("Second prompt")
      setup.mockInput.pressEnter()
      await setup.waitForFrame((frame) => frame.split("\n").slice(0, 20).join("\n").includes("Second prompt"))
      expect(mutations).toHaveLength(submitted)
      first.resolve()
      expect(await secondRequested.promise).toBe("second")
      expect(mutations.slice(-4)).toEqual([
        "model:first",
        "compact:first",
        "model:second",
        "prompt:Second prompt:second",
      ])
    } finally {
      first.resolve()
      setup.renderer.destroy()
      await task
      await server.stop()
    }
  },
)

test.each([
  { name: "command", text: "/deploy now", endpoint: "command", change: true },
  { name: "skill", text: "/tiger", endpoint: "skill", change: true },
  { name: "shell", text: "echo hi", endpoint: "shell", change: true },
  { name: "unchanged command", text: "/deploy now", endpoint: "command", change: false },
])("prepares the prompt selection before $name submission", async ({ name, text, endpoint, change }) => {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  setup.renderer.start()
  const ready = Promise.withResolvers<void>()
  const invoked = Promise.withResolvers<void>()
  const events = createEventStream()
  const sessionID = `ses_${endpoint}_${change ? "changed" : "unchanged"}`
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const mutations: string[] = []
  const calls = createFetch(async (url, request) => {
    if (url.pathname === `/api/session/${sessionID}`)
      return json({
        data: {
          id: sessionID,
          projectID: "project",
          title: `${name} selection fixture`,
          agent: "review",
          model: { providerID: "demo", id: "current" },
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
      return json({
        location,
        data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }],
      })
    if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
    if (url.pathname === "/api/model")
      return json({
        location,
        data: ["current", "selected"].map((id) => ({
          id,
          providerID: "demo",
          name: `${id} model`,
          variants: [],
          cost: [],
          time: { released: 0 },
        })),
      })
    if (url.pathname === "/api/command")
      return json({ location, data: [{ name: "deploy", description: "Deploy", template: "" }] })
    if (url.pathname === "/api/skill")
      return json({
        location,
        data: [{ id: "tiger", name: "Tiger", description: "Tiger", slash: true, location: directory, content: "" }],
      })
    if (request.method === "POST" && url.pathname === `/api/session/${sessionID}/agent`) {
      mutations.push(`agent:${(await request.json()).agent}`)
      return new Response(null, { status: 204 })
    }
    if (request.method === "POST" && url.pathname === `/api/session/${sessionID}/model`) {
      mutations.push(`model:${(await request.json()).model.id}`)
      return new Response(null, { status: 204 })
    }
    if (request.method === "POST" && url.pathname === `/api/session/${sessionID}/${endpoint}`) {
      mutations.push(endpoint)
      invoked.resolve()
      return new Response(null, { status: 204 })
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
    await setup.waitForFrame((frame) => frame.includes("current model"))
    if (change) {
      await setup.mockInput.typeText("/models")
      setup.mockInput.pressEnter()
      await setup.waitForFrame(
        (frame) => frame.includes("Select model") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
      )
      await setup.mockInput.typeText("selected")
      setup.mockInput.pressEnter()
      await setup.waitForFrame((frame) => frame.includes("selected model") && !frame.includes("Select model"))
    }
    if (name === "shell") setup.mockInput.typeText("!")
    await setup.mockInput.typeText(text)
    if (name === "skill") setup.mockInput.pressEscape()
    setup.mockInput.pressEnter()
    await invoked.promise
    expect(mutations).toEqual(["agent:build", ...(change ? ["model:selected"] : []), endpoint])
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
})
