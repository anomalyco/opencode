import { expect, test } from "bun:test"
import { model, renderLocal } from "../fixture/local"

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
