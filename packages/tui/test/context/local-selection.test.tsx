import { expect, test } from "bun:test"
import { agent, model, renderLocal } from "../fixture/local"
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
