import { expect, test } from "bun:test"
import { DialogVariant } from "../../src/component/dialog-variant"
import { agent, model, renderLocal } from "../fixture/local"

test.each([44, 120])("variant picker can explicitly reset an agent variant at %i columns", async (width) => {
  await using setup = await renderLocal({
    width,
    models: [model("first", ["low", "high"])],
    agents: [agent("build", { providerID: "provider", id: "first", variant: "high" })],
  })
  expect(setup.local.model.variant.current()).toBe("high")
  setup.dialog.replace(() => <DialogVariant />)
  await setup.waitForFrame((frame) => frame.includes("Select variant") && frame.includes("Default"))
  await setup.mockInput.typeText("Default")
  await setup.renderOnce()
  setup.mockInput.pressEnter()
  await setup.waitFor(() => setup.dialog.stack.length === 0)
  expect(setup.local.model.variant.current()).toBeUndefined()
})
