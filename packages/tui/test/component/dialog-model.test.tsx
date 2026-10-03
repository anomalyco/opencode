import { expect, test } from "bun:test"
import { DialogModel } from "../../src/component/dialog-model"
import { model, renderLocal } from "../fixture/local"

test("favorites toggle without a connected integration", async () => {
  await using setup = await renderLocal({ models: [model("first"), model("second")] })
  expect(setup.data.location.integration.list() ?? []).toEqual([])

  setup.dialog.replace(() => <DialogModel />)
  await setup.waitForFrame((frame) => frame.includes("Select model") && frame.includes("ctrl+f"))

  setup.mockInput.pressKey("f", { ctrl: true })
  await setup.waitFor(() => setup.local.model.favorite().length === 1)

  expect(setup.local.model.favorite()).toEqual([{ providerID: "provider", modelID: "first" }])
  await setup.waitForFrame((frame) => frame.includes("Favorites"))
})

test("lists saved favorites without a connected integration", async () => {
  await using setup = await renderLocal({
    models: [model("favorite-model"), model("plain-model")],
    preferences: { recent: [], favorite: [{ providerID: "provider", modelID: "favorite-model" }] },
  })
  expect(setup.data.location.integration.list() ?? []).toEqual([])

  setup.dialog.replace(() => <DialogModel />)

  const frame = await setup.waitForFrame((value) => value.includes("Favorites"))
  expect(frame).toContain("favorite-model")
})
