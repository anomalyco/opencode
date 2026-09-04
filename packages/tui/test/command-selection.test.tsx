import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"
import { createAppFixture } from "./fixture/app"

test.each(["steer", "queue"])("custom commands commit the captured selection before %s delivery", async (delivery) => {
  await using state = await tmpdir()
  const agent = Promise.withResolvers<Response>()
  const model = Promise.withResolvers<Response>()
  await using setup = await createCommandFixture({
    state: state.path,
    mutate: (type) => (type === "agent" ? agent.promise : type === "model" ? model.promise : undefined),
  })
  try {
    await setup.select()
    await setup.mockInput.typeText("/review selected input")
    setup.mockInput.pressEscape()
    delivery === "queue" ? setup.mockInput.pressKey("F9") : setup.mockInput.pressEnter()
    await setup.waitForFrame(() => setup.mutations.length > 0)
    expect(setup.mutations).toEqual([{ type: "agent", body: { agent: "plan" } }])
    await setup.waitForFrame((frame) => !frame.includes("/review selected input"))

    // A later local edit must not change the in-flight command's selection.
    setup.mockInput.pressKey("F7")
    await setup.waitForFrame((frame) => frame.includes("high"))
    agent.resolve(new Response(null, { status: 204 }))
    await setup.waitFor(() => setup.mutations.length === 2)
    expect(setup.mutations[1]).toEqual({
      type: "model",
      body: { model: { providerID: "demo", id: "second", variant: "low" } },
    })
    model.resolve(new Response(null, { status: 204 }))
    await setup.waitFor(() => setup.mutations.length === 3)
    // Keep command expansion/overrides on the server, not in the prompt API.
    expect(setup.mutations[2]).toEqual({
      type: "command",
      body: { command: "review", text: "selected input", files: [], agents: [], delivery },
    })
  } finally {
    agent.resolve(new Response(null, { status: 204 }))
    model.resolve(new Response(null, { status: 204 }))
  }
})

test.each(["agent", "model", "command"])("command %s failure restores the submitted composer", async (failure) => {
  await using state = await tmpdir()
  const response = Promise.withResolvers<Response>()
  await using setup = await createCommandFixture({
    state: state.path,
    mutate: (type) => (type === failure ? response.promise : undefined),
  })
  try {
    await setup.select()
    await setup.mockInput.typeText("/review restore this input")
    setup.mockInput.pressEscape()
    setup.mockInput.pressEnter()
    await setup.waitFor(() => setup.mutations.some((item) => item.type === failure))
    await setup.waitForFrame((frame) => !frame.includes("/review restore this input"))
    response.resolve(json({ message: `${failure} rejected` }, { status: 400 }))
    const frame = await setup.waitForFrame(
      (frame) => frame.includes("Failed to run command") && frame.includes(`${failure} rejected`),
    )
    expect(frame).toContain("Plan · second model Demo · low")
    const composer = setup.renderer.currentFocusedRenderable
    expect(composer).toBeInstanceOf(TextareaRenderable)
    if (!(composer instanceof TextareaRenderable)) throw new Error("Expected the restored composer")
    expect(composer.plainText).toBe("/review restore this input")
    expect(setup.mutations.map((item) => item.type)).toEqual(
      ["agent", "model", "command"].slice(0, ["agent", "model", "command"].indexOf(failure) + 1),
    )
    setup.mockInput.pressKey("c", { ctrl: true })
    await setup.waitForFrame((frame) => !frame.includes("/review restore this input"))
  } finally {
    response.resolve(new Response(null, { status: 204 }))
  }
})

test("command selection failure does not overwrite newly typed input", async () => {
  await using state = await tmpdir()
  const response = Promise.withResolvers<Response>()
  await using setup = await createCommandFixture({
    state: state.path,
    mutate: (type) => (type === "model" ? response.promise : undefined),
  })
  try {
    await setup.select()
    await setup.mockInput.typeText("/review earlier input")
    setup.mockInput.pressEscape()
    setup.mockInput.pressEnter()
    await setup.waitFor(() => setup.mutations.some((item) => item.type === "model"))
    await setup.mockInput.typeText("Keep this new draft")
    response.resolve(json({ message: "Selection rejected" }, { status: 400 }))
    await setup.waitForFrame((frame) => frame.includes("Selection rejected"))
    const composer = setup.renderer.currentFocusedRenderable
    expect(composer).toBeInstanceOf(TextareaRenderable)
    if (!(composer instanceof TextareaRenderable)) throw new Error("Expected the active composer")
    expect(composer.plainText).toBe("Keep this new draft")
    expect(setup.mutations.map((item) => item.type)).toEqual(["agent", "model"])
    setup.mockInput.pressKey("c", { ctrl: true })
    await setup.waitForFrame((frame) => !frame.includes("Keep this new draft"))
  } finally {
    response.resolve(new Response(null, { status: 204 }))
  }
})

test("new-session commands wait for creation and environment setup before selecting and running", async () => {
  await using state = await tmpdir()
  const create = Promise.withResolvers<void>()
  const environment = Promise.withResolvers<Response>()
  await using setup = await createCommandFixture({
    state: state.path,
    newSession: true,
    create: create.promise,
    mutate: (type) => (type === "environment" ? environment.promise : undefined),
  })
  try {
    await setup.select()
    await setup.mockInput.typeText("/review new session input")
    setup.mockInput.pressEscape()
    setup.mockInput.pressEnter()
    await setup.waitFor(() => setup.mutations.some((item) => item.type === "create"))
    await setup.renderOnce()
    expect(setup.mutations.map((item) => item.type)).toEqual(["create"])
    expect(setup.mutations[0].body).toMatchObject({
      agent: "plan",
      model: { providerID: "demo", id: "second", variant: "low" },
    })
    create.resolve()
    await setup.waitFor(() => setup.mutations.some((item) => item.type === "environment"))
    await setup.renderOnce()
    expect(setup.mutations.map((item) => item.type)).toEqual(["create", "environment"])
    environment.resolve(new Response(null, { status: 204 }))
    await setup.waitFor(() => setup.mutations.some((item) => item.type === "command"))
    expect(setup.mutations.slice(-2)).toEqual([
      { type: "model", body: { model: { providerID: "demo", id: "second", variant: "low" } } },
      {
        type: "command",
        body: { command: "review", text: "new session input", files: [], agents: [], delivery: "steer" },
      },
    ])
    expect(setup.mutations.some((item) => item.type === "agent")).toBe(false)
  } finally {
    create.resolve()
    environment.resolve(new Response(null, { status: 204 }))
  }
})

async function createCommandFixture(input: {
  state: string
  newSession?: boolean
  create?: Promise<void>
  mutate?: (type: string) => Response | Promise<Response> | undefined
}) {
  const mutations: { type: string; body: unknown }[] = []
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const session = {
    id: `ses_${crypto.randomUUID()}`,
    projectID: "project",
    title: "Command selection fixture",
    agent: "build",
    model: { providerID: "demo", id: "first" },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const setup = await createAppFixture({
    state: input.state,
    config: {
      animations: false,
      keybinds: { "agent.cycle": "f6", "variant.cycle": "f7", "model.list": "f8", "prompt.queue": "f9" },
    },
    args: input.newSession ? {} : { sessionID: session.id },
    environment: input.newSession ? { COMMAND_SELECTION_FIXTURE: "true" } : undefined,
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: ["build", "plan"].map((id) => ({ id, mode: "primary", hidden: false, permissions: [] })),
        })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: ["first", "second"].map((id) => ({
            id,
            providerID: "demo",
            name: `${id} model`,
            variants: [{ id: "low" }, { id: "high" }],
            cost: [],
            time: { released: 0 },
          })),
        })
      if (url.pathname === "/api/command")
        return json({ location, data: [{ name: "review", description: "Review the input" }] })
      if (url.pathname === "/api/session" && request.method === "POST") {
        const body: { id: string; agent: string; model: typeof session.model } = await request.json()
        Object.assign(session, body)
        mutations.push({ type: "create", body })
        await input.create
        return json({ data: session })
      }
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      const type = url.pathname.match(/^\/api\/session\/[^/]+\/(agent|model|command|environment)$/)?.[1]
      if (type) {
        mutations.push({ type, body: await request.json() })
        return input.mutate?.(type) ?? new Response(null, { status: 204 })
      }
      return undefined
    },
  })
  return {
    ...setup,
    mutations,
    async select() {
      await setup.ready
      await setup.waitForFrame((frame) => frame.includes("Build · first model"))
      setup.mockInput.pressKey("F6")
      await setup.waitForFrame((frame) => frame.includes("Plan ·"))
      setup.mockInput.pressKey("F8")
      await setup.waitForFrame(
        (frame) => frame.includes("Select model") && setup.renderer.currentFocusedRenderable instanceof InputRenderable,
      )
      await setup.mockInput.typeText("second")
      await setup.renderOnce()
      setup.mockInput.pressEnter()
      await setup.waitForFrame((frame) => frame.includes("Select variant") && frame.includes("low"))
      await setup.mockInput.typeText("low")
      await setup.renderOnce()
      setup.mockInput.pressEnter()
      await setup.waitForFrame(
        (frame) =>
          frame.includes("Plan · second model Demo · low") &&
          setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
      )
    },
  }
}
