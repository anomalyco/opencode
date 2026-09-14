import { expect, test } from "bun:test"
import { agent, model, renderLocal, session } from "../fixture/local"
import { json } from "../fixture/tui-client"

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

test("uses the last configured model and variant ahead of recents", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second", ["low", "high"]), model("third")],
    preferences: { recent: [{ providerID: "provider", modelID: "third" }] },
    fetch: (url) => {
      if (url.pathname === "/api/config")
        return json([
          { type: "document", info: { model: "provider/first" } },
          { type: "document", info: { model: { providerID: "provider", model: "second", variant: "high" } } },
          { type: "document", info: {} },
        ])
    },
  })
  expect(setup.local.model.selection()).toEqual({ providerID: "provider", modelID: "second", variant: "high" })
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

test("falls back from an unavailable session model without changing durable state", async () => {
  const selected = { providerID: "provider", id: "missing", variant: "high" }
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
})

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

test("same-model agent switches clear drafts without a model acknowledgment", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second")],
    agents: [agent("build"), agent("plan")],
    sessions: [session("ses_first", { providerID: "provider", id: "first" })],
    fetch: selectionMessage,
  })
  await setup.data.session.sync("ses_first")
  setup.route.navigate({ type: "session", sessionID: "ses_first" })
  setup.local.agent.set("plan")
  setup.local.model.trackSessionCommit("ses_first", { providerID: "provider", id: "first" }, "plan")
  await publishSelection(setup, "plan", "first", false)
  await publishSelection(setup, "plan", "second")
  expect(setup.local.model.current()?.modelID).toBe("second")
})

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
