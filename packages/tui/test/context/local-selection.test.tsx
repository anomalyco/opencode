import { Agent } from "@opencode/schema/agent"
import { Event } from "@opencode/schema/event"
import { Session } from "@opencode/schema/session"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { expect, test } from "bun:test"
import { agent, model, renderLocal, session } from "../fixture/local"
import { json } from "../fixture/tui-client"

test("cycles all recent models in a stable order in both directions", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second"), model("third")],
    preferences: {
      recent: ["first", "second", "third"].map((modelID) => ({
        providerID: Provider.ID.make("provider", { disableChecks: true }),
        modelID: Model.ID.make(modelID, { disableChecks: true }),
      })),
    },
  })
  expect<unknown>(setup.local.model.current()?.modelID).toBe("first")
  for (const id of ["second", "third", "first"]) {
    setup.local.model.cycle(1)
    expect(setup.local.model.current()?.modelID).toBe(Model.ID.make(id, { disableChecks: true }))
  }
  for (const id of ["third", "second", "first"]) {
    setup.local.model.cycle(-1)
    expect(setup.local.model.current()?.modelID).toBe(Model.ID.make(id, { disableChecks: true }))
  }
})

test("uses the last configured model and variant ahead of recents", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second", ["low", "high"]), model("third")],
    preferences: {
      recent: [
        {
          providerID: Provider.ID.make("provider", { disableChecks: true }),
          modelID: Model.ID.make("third", { disableChecks: true }),
        },
      ],
    },
    fetch: (url) => {
      if (url.pathname === "/api/config")
        return json([
          { type: "document", info: { model: "provider/first" } },
          {
            type: "document",
            info: {
              model: {
                providerID: Provider.ID.make("provider", { disableChecks: true }),
                model: "second",
                variant: "high",
              },
            },
          },
          { type: "document", info: {} },
        ])
    },
  })
  expect<unknown>(setup.local.model.selection()).toEqual({
    providerID: "provider",
    modelID: "second",
    variant: Model.VariantID.make("high", { disableChecks: true }),
  })
})

test("switching agents restores their model and variant within the session", async () => {
  await using setup = await renderLocal({
    models: [model("first", ["low", "high"]), model("second", ["low", "high"]), model("third", ["low", "high"])],
    agents: [
      agent("build", {
        providerID: Provider.ID.make("provider", { disableChecks: true }),
        id: Model.ID.make("first", { disableChecks: true }),
        variant: Model.VariantID.make("high", { disableChecks: true }),
      }),
      agent("plan", {
        providerID: Provider.ID.make("provider", { disableChecks: true }),
        id: Model.ID.make("second", { disableChecks: true }),
        variant: Model.VariantID.make("low", { disableChecks: true }),
      }),
    ],
    sessions: [
      session(Session.ID.make("ses_first", { disableChecks: true }), {
        providerID: Provider.ID.make("provider", { disableChecks: true }),
        id: Model.ID.make("first", { disableChecks: true }),
        variant: Model.VariantID.make("low", { disableChecks: true }),
      }),
    ],
  })
  await setup.data.session.sync(Session.ID.make("ses_first", { disableChecks: true }))
  setup.route.navigate({ type: "session", sessionID: Session.ID.make("ses_first", { disableChecks: true }) })
  expect<unknown>(setup.local.model.selection()).toEqual({
    providerID: "provider",
    modelID: "first",
    variant: Model.VariantID.make("low", { disableChecks: true }),
  })
  setup.local.agent.move(1)
  expect<unknown>(setup.local.agent.current()?.id).toBe("plan")
  expect<unknown>(setup.local.model.selection()).toEqual({
    providerID: "provider",
    modelID: "second",
    variant: Model.VariantID.make("low", { disableChecks: true }),
  })
  setup.local.model.set({
    providerID: Provider.ID.make("provider", { disableChecks: true }),
    modelID: Model.ID.make("third", { disableChecks: true }),
  })
  setup.local.model.variant.set("high")
  setup.local.agent.move(-1)
  expect<unknown>(setup.local.model.selection()).toEqual({
    providerID: "provider",
    modelID: "first",
    variant: Model.VariantID.make("low", { disableChecks: true }),
  })
  setup.local.agent.set("plan")
  expect<unknown>(setup.local.model.selection()).toEqual({
    providerID: "provider",
    modelID: "third",
    variant: Model.VariantID.make("high", { disableChecks: true }),
  })
})

test("agent and model drafts are isolated across sessions and survive navigation", async () => {
  await using setup = await renderLocal({
    models: [model("first", ["low", "high"]), model("second", ["low", "high"])],
    agents: [
      agent("build"),
      agent("plan", {
        providerID: Provider.ID.make("provider", { disableChecks: true }),
        id: Model.ID.make("second", { disableChecks: true }),
      }),
    ],
    sessions: [
      session(Session.ID.make("ses_first", { disableChecks: true }), {
        providerID: Provider.ID.make("provider", { disableChecks: true }),
        id: Model.ID.make("first", { disableChecks: true }),
        variant: Model.VariantID.make("low", { disableChecks: true }),
      }),
      session(
        Session.ID.make("ses_second", { disableChecks: true }),
        {
          providerID: Provider.ID.make("provider", { disableChecks: true }),
          id: Model.ID.make("second", { disableChecks: true }),
          variant: Model.VariantID.make("high", { disableChecks: true }),
        },
        Agent.ID.make("plan", { disableChecks: true }),
      ),
    ],
  })
  await Promise.all([
    setup.data.session.sync(Session.ID.make("ses_first", { disableChecks: true })),
    setup.data.session.sync(Session.ID.make("ses_second", { disableChecks: true })),
  ])
  setup.route.navigate({ type: "session", sessionID: Session.ID.make("ses_first", { disableChecks: true }) })
  setup.local.agent.set("plan")
  setup.local.model.variant.set("low")
  setup.route.navigate({ type: "session", sessionID: Session.ID.make("ses_second", { disableChecks: true }) })
  expect<unknown>(setup.local.agent.current()?.id).toBe("plan")
  expect(setup.local.model.variant.current()).toBe(Model.VariantID.make("high", { disableChecks: true }))
  setup.route.navigate({ type: "session", sessionID: Session.ID.make("ses_first", { disableChecks: true }) })
  expect<unknown>(setup.local.agent.current()?.id).toBe("plan")
  expect(setup.local.model.variant.current()).toBe(Model.VariantID.make("low", { disableChecks: true }))
  setup.local.agent.set("build")
  expect<unknown>(setup.local.model.selection()).toEqual({
    providerID: "provider",
    modelID: "first",
    variant: Model.VariantID.make("low", { disableChecks: true }),
  })
})

test("falls back from an unavailable session model without changing durable state", async () => {
  const selected = {
    providerID: Provider.ID.make("provider", { disableChecks: true }),
    id: Model.ID.make("missing", { disableChecks: true }),
    variant: Model.VariantID.make("high", { disableChecks: true }),
  }
  await using setup = await renderLocal({
    models: [model("first", ["low", "high"]), model("second")],
    agents: [
      agent("build", {
        providerID: Provider.ID.make("provider", { disableChecks: true }),
        id: Model.ID.make("first", { disableChecks: true }),
        variant: Model.VariantID.make("low", { disableChecks: true }),
      }),
    ],
    sessions: [session(Session.ID.make("ses_first", { disableChecks: true }), selected)],
  })
  await setup.data.session.sync(Session.ID.make("ses_first", { disableChecks: true }))
  setup.route.navigate({ type: "session", sessionID: Session.ID.make("ses_first", { disableChecks: true }) })
  expect<unknown>(setup.local.model.selection()).toEqual({
    providerID: "provider",
    modelID: "first",
    variant: Model.VariantID.make("low", { disableChecks: true }),
  })
  expect(setup.local.model.available()).toBe(true)
  expect(setup.data.session.get(Session.ID.make("ses_first", { disableChecks: true }))?.model).toEqual(selected)
})

test("a manual agent switch supersedes the CLI agent after its commit", async () => {
  await using setup = await renderLocal({
    args: { agent: Agent.ID.make("build", { disableChecks: true }) },
    agents: [agent("build"), agent("plan")],
    sessions: [
      session(Session.ID.make("ses_first", { disableChecks: true }), {
        providerID: Provider.ID.make("provider", { disableChecks: true }),
        id: Model.ID.make("first", { disableChecks: true }),
      }),
    ],
    fetch: selectionMessage,
  })
  await setup.data.session.sync(Session.ID.make("ses_first", { disableChecks: true }))
  setup.route.navigate({ type: "session", sessionID: Session.ID.make("ses_first", { disableChecks: true }) })
  setup.local.agent.set("plan")
  await publishSelection(setup, "plan", "first")
  expect<unknown>(setup.local.agent.current()?.id).toBe("plan")
  setup.route.navigate({ type: "home" })
  setup.route.navigate({ type: "session", sessionID: Session.ID.make("ses_first", { disableChecks: true }) })
  expect<unknown>(setup.local.agent.current()?.id).toBe("plan")
})

test("a late inactive-agent acknowledgment preserves its choice after the active agent commits", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second"), model("third")],
    agents: [
      agent("build"),
      agent("plan", {
        providerID: Provider.ID.make("provider", { disableChecks: true }),
        id: Model.ID.make("second", { disableChecks: true }),
      }),
    ],
    sessions: [
      session(Session.ID.make("ses_first", { disableChecks: true }), {
        providerID: Provider.ID.make("provider", { disableChecks: true }),
        id: Model.ID.make("first", { disableChecks: true }),
      }),
    ],
    fetch: selectionMessage,
  })
  await setup.data.session.sync(Session.ID.make("ses_first", { disableChecks: true }))
  setup.route.navigate({ type: "session", sessionID: Session.ID.make("ses_first", { disableChecks: true }) })
  setup.local.agent.set("plan")
  setup.local.model.set({
    providerID: Provider.ID.make("provider", { disableChecks: true }),
    modelID: Model.ID.make("third", { disableChecks: true }),
  })
  setup.local.model.trackSessionCommit(
    Session.ID.make("ses_first", { disableChecks: true }),
    {
      providerID: Provider.ID.make("provider", { disableChecks: true }),
      id: Model.ID.make("third", { disableChecks: true }),
    },
    Agent.ID.make("plan", { disableChecks: true }),
  )
  setup.local.agent.set("build")
  await publishSelection(setup, "plan", "third")
  setup.local.model.trackSessionCommit(
    Session.ID.make("ses_first", { disableChecks: true }),
    {
      providerID: Provider.ID.make("provider", { disableChecks: true }),
      id: Model.ID.make("first", { disableChecks: true }),
    },
    Agent.ID.make("build", { disableChecks: true }),
  )
  await publishSelection(setup, "build", "first")
  setup.local.agent.set("plan")
  expect<unknown>(setup.local.model.current()?.modelID).toBe("third")
})

test("same-model agent switches clear drafts without a model acknowledgment", async () => {
  await using setup = await renderLocal({
    models: [model("first"), model("second")],
    agents: [agent("build"), agent("plan")],
    sessions: [
      session(Session.ID.make("ses_first", { disableChecks: true }), {
        providerID: Provider.ID.make("provider", { disableChecks: true }),
        id: Model.ID.make("first", { disableChecks: true }),
      }),
    ],
    fetch: selectionMessage,
  })
  await setup.data.session.sync(Session.ID.make("ses_first", { disableChecks: true }))
  setup.route.navigate({ type: "session", sessionID: Session.ID.make("ses_first", { disableChecks: true }) })
  setup.local.agent.set("plan")
  setup.local.model.trackSessionCommit(
    Session.ID.make("ses_first", { disableChecks: true }),
    {
      providerID: Provider.ID.make("provider", { disableChecks: true }),
      id: Model.ID.make("first", { disableChecks: true }),
    },
    Agent.ID.make("plan", { disableChecks: true }),
  )
  await publishSelection(setup, "plan", "first", false)
  await publishSelection(setup, "plan", "second")
  expect<unknown>(setup.local.model.current()?.modelID).toBe("second")
})

async function publishSelection(
  setup: Awaited<ReturnType<typeof renderLocal>>,
  agent: string,
  modelID: string,
  changed = true,
) {
  setup.events.emit({
    id: Event.ID.make(`evt_${crypto.randomUUID()}`, { disableChecks: true }),
    type: "session.agent.selected",
    created: 1,
    durable: { aggregateID: Session.ID.make("ses_first", { disableChecks: true }), seq: 1, version: 1 },
    data: {
      sessionID: Session.ID.make("ses_first", { disableChecks: true }),
      agent: Agent.ID.make(agent, { disableChecks: true }),
    },
  })
  if (changed)
    setup.events.emit({
      id: Event.ID.make(`evt_${crypto.randomUUID()}_${modelID}`, { disableChecks: true }),
      type: "session.model.selected",
      created: 2,
      durable: { aggregateID: Session.ID.make("ses_first", { disableChecks: true }), seq: 2, version: 1 },
      data: {
        sessionID: Session.ID.make("ses_first", { disableChecks: true }),
        model: {
          providerID: Provider.ID.make("provider", { disableChecks: true }),
          id: Model.ID.make(modelID, { disableChecks: true }),
        },
      },
    })
  await setup.waitFor(async () => {
    await Bun.sleep(10)
    const session = setup.data.session.get(Session.ID.make("ses_first", { disableChecks: true }))
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
      model: { providerID: Provider.ID.make("provider", { disableChecks: true }), id: id.split("_").at(-1) },
      time: { created: 2 },
    },
  })
}
