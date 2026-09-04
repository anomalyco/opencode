import { expect, test } from "bun:test"
import { agent, model, renderLocal, session } from "../fixture/local"
import { directory, json } from "../fixture/tui-client"

test("cycles all recent models in a stable order in both directions", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second"), model("third")],
    preferences: { recent: ["first", "second", "third"].map((modelID) => ({ providerID: "provider", modelID })) },
  })
  expect(setup.local.model.current()?.modelID).toBe("first")
  for (const id of ["second", "third", "first"]) {
    setup.local.model.cycle(1)
    expect(setup.local.model.current()?.modelID).toBe(id)
  }
  for (const id of ["third", "second", "first"]) {
    setup.local.model.cycle(-1)
    expect(setup.local.model.current()?.modelID).toBe(id)
  }
})

test("recent cycling skips unavailable models and starts outside the list", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second"), model("third")],
    args: { model: "provider/first" },
    preferences: { recent: ["missing", "second", "third"].map((modelID) => ({ providerID: "provider", modelID })) },
  })
  setup.local.model.cycle(1)
  expect(setup.local.model.current()?.modelID).toBe("second")
  setup.local.model.cycle(1)
  expect(setup.local.model.current()?.modelID).toBe("third")
  setup.local.model.set({ providerID: "provider", modelID: "first" })
  setup.local.model.cycle(-1)
  expect(setup.local.model.current()?.modelID).toBe("third")
})

test.each(["provider/second", { providerID: "provider", model: "second" }])(
  "uses the last configured model ahead of recents (%j)",
  async (configured) => {
    await using setup = await renderLocal({
      models: [model("first"), model("second"), model("third")],
      preferences: { recent: [{ providerID: "provider", modelID: "third" }] },
      fetch: (url) => {
        if (url.pathname === "/api/config")
          return json([
            { type: "document", info: { model: "provider/first" } },
            { type: "document", info: { model: configured } },
            { type: "document", info: {} },
          ])
      },
    })
    expect(setup.local.model.current()?.modelID).toBe("second")
  },
)

test("agent models, CLI models, and explicit selections take precedence over the global model", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second"), model("third")],
    agents: [agent("build"), agent("plan", { providerID: "provider", id: "third" })],
    args: { model: "provider/first" },
    fetch: (url) => {
      if (url.pathname === "/api/config") return json([{ type: "document", info: { model: "provider/second" } }])
    },
  })
  expect(setup.local.model.current()?.modelID).toBe("first")
  setup.local.agent.set("plan")
  expect(setup.local.model.current()?.modelID).toBe("third")
  setup.local.model.set({ providerID: "provider", modelID: "second" })
  expect(setup.local.model.current()?.modelID).toBe("second")
})

test("model defaults follow the location and refresh after catalog invalidation", async () => {
  let selected = "second"
  await using setup = await renderLocal({
    models: [model("first"), model("second"), model("third")],
    fetch: (url) => {
      if (url.pathname === "/api/config")
        return json([
          {
            type: "document",
            info: {
              model: `provider/${url.searchParams.get("location[directory]") === directory ? "first" : selected}`,
            },
          },
        ])
    },
  })
  expect(setup.local.model.current()?.modelID).toBe("first")
  setup.location.set({ directory: "/other" })
  await setup.data.location.sync({ directory: "/other" })
  expect(setup.local.model.current()?.modelID).toBe("second")
  selected = "third"
  setup.data.location.invalidate({ directory: "/other" })
  await setup.data.location.sync({ directory: "/other" })
  expect(setup.local.model.current()?.modelID).toBe("third")
})

test("uses the agent variant only for its configured model and lets cycling select default", async () => {
  await using setup = await renderLocal({
    models: [model("first", ["low", "high"]), model("second", ["low", "high"])],
    agents: [agent("build", { providerID: "provider", id: "first", variant: "high" })],
  })
  expect(setup.local.model.variant.current()).toBe("high")
  setup.local.model.variant.cycle()
  expect(setup.local.model.variant.current()).toBeUndefined()
  setup.local.model.variant.cycle()
  expect(setup.local.model.variant.current()).toBe("low")
  setup.local.model.set({ providerID: "provider", modelID: "second" })
  expect(setup.local.model.variant.current()).toBeUndefined()
})

test.each(["low", "default"])("saved variant %s overrides the agent variant", async (variant) => {
  await using setup = await renderLocal({
    models: [model("first", ["low", "high"])],
    agents: [agent("build", { providerID: "provider", id: "first", variant: "high" })],
    preferences: { variant: { "provider/first": variant } },
  })
  expect(setup.local.model.variant.current()).toBe(variant === "default" ? undefined : variant)
})

test("ignores unsupported agent variants", async () => {
  await using setup = await renderLocal({
    models: [model("first", ["low", "high"])],
    agents: [agent("build", { providerID: "provider", id: "first", variant: "missing" })],
  })
  expect(setup.local.model.selection()?.variant).toBeUndefined()
})

test("switching agents restores their model and variant within the session", async () => {
  await using setup = await renderLocal({
    models: [model("first", ["low", "high"]), model("second", ["low", "high"]), model("third", ["low", "high"])],
    agents: [
      agent("build", { providerID: "provider", id: "first", variant: "high" }),
      agent("plan", { providerID: "provider", id: "second", variant: "low" }),
    ],
    sessions: [session("ses_first", { providerID: "provider", id: "first", variant: "low" })],
  })
  await setup.data.session.sync("ses_first")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "first", variant: "low" })
  setup.local.agent.move(1)
  expect(setup.local.agent.current()?.id).toBe("plan")
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "second", variant: "low" })
  setup.local.model.set({ providerID: "provider", modelID: "third" })
  setup.local.model.variant.set("high")
  setup.local.agent.move(-1)
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "first", variant: "low" })
  setup.local.agent.set("plan")
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "third", variant: "high" })
})

test("agent and model drafts are isolated across sessions and survive navigation", async () => {
  await using setup = await renderLocal({
    models: [model("first", ["low", "high"]), model("second", ["low", "high"])],
    agents: [agent("build"), agent("plan", { providerID: "provider", id: "second" })],
    sessions: [
      session("ses_first", { providerID: "provider", id: "first", variant: "low" }),
      session("ses_second", { providerID: "provider", id: "second", variant: "high" }, "plan"),
    ],
  })
  await Promise.all([setup.data.session.sync("ses_first"), setup.data.session.sync("ses_second")])
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  setup.local.agent.set("plan")
  setup.local.model.variant.set("low")
  setup.route.navigate({ type: "session", sessionID: "ses_second" })
  expect(setup.local.agent.current()?.id).toBe("plan")
  expect(setup.local.model.variant.current()).toBe("high")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  expect(setup.local.agent.current()?.id).toBe("plan")
  expect(setup.local.model.variant.current()).toBe("low")
  setup.local.agent.set("build")
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "first", variant: "low" })
})

test("selection commits clear only the captured agent's draft and retain other agents", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second"), model("third")],
    agents: [agent("build"), agent("plan", { providerID: "provider", id: "second" })],
    sessions: [session("ses_first", { providerID: "provider", id: "first" })],
    fetch: (url) => {
      if (url.pathname.includes("/message/"))
        return json({
          data: {
            id: url.pathname.split("/").at(-1),
            type: "model-switched",
            model: { providerID: "provider", id: url.pathname.endsWith("msg_model") ? "second" : "third" },
            time: { created: 2 },
          },
        })
    },
  })
  await setup.data.session.sync("ses_first")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  setup.local.agent.set("plan")
  setup.local.model.set({ providerID: "provider", modelID: "second" })
  setup.local.agent.set("build")
  setup.local.model.trackSessionCommit("ses_first", { providerID: "provider", id: "second" }, "plan")
  setup.events.emit({
    id: "evt_agent",
    type: "session.agent.selected",
    created: 1,
    durable: { aggregateID: "ses_first", seq: 1, version: 1 },
    data: { sessionID: "ses_first", agent: "plan", previous: "build" },
  })
  setup.events.emit({
    id: "evt_model",
    type: "session.model.selected",
    created: 2,
    durable: { aggregateID: "ses_first", seq: 2, version: 1 },
    data: { sessionID: "ses_first", model: { providerID: "provider", id: "second" } },
  })
  await setup.waitFor(async () => {
    await Bun.sleep(10)
    return setup.data.session.get("ses_first")?.model?.id === "second"
  })
  expect(setup.local.agent.current()?.id).toBe("build")
  expect(setup.local.model.current()?.modelID).toBe("first")
  setup.local.agent.set("plan")
  expect(setup.local.model.current()?.modelID).toBe("second")
  setup.events.emit({
    id: "evt_external_model",
    type: "session.model.selected",
    created: 3,
    durable: { aggregateID: "ses_first", seq: 3, version: 1 },
    data: { sessionID: "ses_first", model: { providerID: "provider", id: "third" } },
  })
  await setup.waitFor(async () => {
    await Bun.sleep(10)
    return setup.local.model.current()?.modelID === "third"
  })
  setup.local.agent.set("build")
  expect(setup.local.model.current()?.modelID).toBe("first")
})

test.each([undefined, { providerID: "provider", id: "missing", variant: "high" }])(
  "falls back from a missing or unavailable session model (%j)",
  async (selected) => {
    await using setup = await renderLocal({
      models: [model("first", ["low", "high"]), model("second")],
      agents: [agent("build", { providerID: "provider", id: "first", variant: "low" })],
      sessions: [session("ses_first", selected)],
    })
    await setup.data.session.sync("ses_first")
    setup.route.navigate({ type: "session", sessionID: "ses_first" })
    expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "first", variant: "low" })
    expect(setup.local.model.available()).toBe(true)
    expect(setup.data.session.get("ses_first")?.model).toEqual(selected)
  },
)

test("unavailable agent and global defaults fall back to an available recent model", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second")],
    agents: [agent("build", { providerID: "provider", id: "missing" })],
    sessions: [session("ses_first", { providerID: "provider", id: "removed" })],
    preferences: { recent: [{ providerID: "provider", modelID: "second" }] },
    fetch: (url) => {
      if (url.pathname === "/api/config") return json([{ type: "document", info: { model: "provider/missing" } }])
    },
  })
  await setup.data.session.sync("ses_first")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  expect(setup.local.model.current()?.modelID).toBe("second")
})

test("a draft model that becomes unavailable falls back without blocking the session", async () => {
  let available = [model("first"), model("second")]
  await using setup = await renderLocal({
    sessions: [session("ses_first", { providerID: "provider", id: "first" })],
    fetch: (url) => {
      if (url.pathname === "/api/model") return json({ location: { directory }, data: available })
    },
  })
  await setup.data.session.sync("ses_first")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  setup.local.model.set({ providerID: "provider", modelID: "second" })
  expect(setup.local.model.current()?.modelID).toBe("second")
  available = [model("first")]
  setup.data.location.model.invalidate()
  await setup.data.location.model.sync()
  expect(setup.local.model.current()?.modelID).toBe("first")
  expect(setup.local.model.available()).toBe(true)
})

test("drops unavailable session variants rather than sending a hidden invalid variant", async () => {
  await using setup = await renderLocal({
    models: [model("first", ["low"])],
    sessions: [session("ses_first", { providerID: "provider", id: "first", variant: "removed" })],
  })
  await setup.data.session.sync("ses_first")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "first", variant: undefined })
})

test.each(["global", "agent", "saved", "default"])(
  "resolves %s variants ahead of the global model variant",
  async (source) => {
    await using setup = await renderLocal({
      models: [model("first", ["low", "medium", "high"]), model("second", ["low", "high"])],
      agents: [
        agent("build", source === "global" ? undefined : { providerID: "provider", id: "first", variant: "low" }),
      ],
      preferences: {
        variant:
          source === "saved" || source === "default"
            ? { "provider/first": source === "saved" ? "medium" : "default" }
            : {},
      },
      fetch: (url) => {
        if (url.pathname === "/api/config")
          return json([
            { type: "document", info: { model: { providerID: "provider", model: "first", variant: "high" } } },
          ])
      },
    })
    expect(setup.local.model.variant.current()).toBe(
      source === "global" ? "high" : source === "agent" ? "low" : source === "saved" ? "medium" : undefined,
    )
    setup.local.model.set({ providerID: "provider", modelID: "second" })
    expect(setup.local.model.variant.current()).toBeUndefined()
  },
)

test("a manual agent switch supersedes the CLI agent after its commit", async () => {
  await using setup = await renderLocal({
    args: { agent: "build" },
    agents: [agent("build"), agent("plan")],
    sessions: [session("ses_first", { providerID: "provider", id: "first" })],
    fetch: selectionMessage,
  })
  await setup.data.session.sync("ses_first")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  setup.local.agent.set("plan")
  await publishSelection(setup, "plan", "first")
  expect(setup.local.agent.current()?.id).toBe("plan")
  setup.route.navigate({ type: "home" })
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  expect(setup.local.agent.current()?.id).toBe("plan")
})

test("a late inactive-agent acknowledgment preserves its choice after the active agent commits", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second"), model("third")],
    agents: [agent("build"), agent("plan", { providerID: "provider", id: "second" })],
    sessions: [session("ses_first", { providerID: "provider", id: "first" })],
    fetch: selectionMessage,
  })
  await setup.data.session.sync("ses_first")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  setup.local.agent.set("plan")
  setup.local.model.set({ providerID: "provider", modelID: "third" })
  setup.local.model.trackSessionCommit("ses_first", { providerID: "provider", id: "third" }, "plan")
  setup.local.agent.set("build")
  await publishSelection(setup, "plan", "third")
  setup.local.model.trackSessionCommit("ses_first", { providerID: "provider", id: "first" }, "build")
  await publishSelection(setup, "build", "first")
  setup.local.agent.set("plan")
  expect(setup.local.model.current()?.modelID).toBe("third")
})

test.each(["before", "after"])(
  "same-model agent switches clear drafts when the agent event arrives %s preparation",
  async (timing) => {
    await using setup = await renderLocal({
      models: [model("first"), model("second")],
      agents: [agent("build"), agent("plan")],
      sessions: [session("ses_first", { providerID: "provider", id: "first" })],
      fetch: selectionMessage,
    })
    await setup.data.session.sync("ses_first")
    setup.route.navigate({ type: "session", sessionID: "ses_first" })
    setup.local.agent.set("plan")
    if (timing === "before") await publishSelection(setup, "plan", "first", false)
    setup.local.model.trackSessionCommit("ses_first", { providerID: "provider", id: "first" }, "plan")
    if (timing === "after") await publishSelection(setup, "plan", "first", false)
    await publishSelection(setup, "plan", "second")
    expect(setup.local.model.current()?.modelID).toBe("second")
  },
)

async function publishSelection(
  setup: Awaited<ReturnType<typeof renderLocal>>,
  agent: string,
  modelID: string,
  changed = true,
) {
  setup.events.emit({
    id: `evt_${crypto.randomUUID()}`,
    type: "session.agent.selected",
    created: 1,
    durable: { aggregateID: "ses_first", seq: 1, version: 1 },
    data: { sessionID: "ses_first", agent },
  })
  if (changed)
    setup.events.emit({
      id: `evt_${crypto.randomUUID()}_${modelID}`,
      type: "session.model.selected",
      created: 2,
      durable: { aggregateID: "ses_first", seq: 2, version: 1 },
      data: { sessionID: "ses_first", model: { providerID: "provider", id: modelID } },
    })
  await setup.waitFor(async () => {
    await Bun.sleep(10)
    const session = setup.data.session.get("ses_first")
    return session?.agent === agent && session.model?.id === modelID
  })
}

function selectionMessage(url: URL) {
  if (!url.pathname.includes("/message/")) return
  const id = url.pathname.split("/").at(-1)!
  return json({
    data: {
      id,
      type: "model-switched",
      model: { providerID: "provider", id: id.split("_").at(-1) },
      time: { created: 2 },
    },
  })
}
