import { InputRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { copyPlugin } from "./fixture/fixture"

test("plugin toggles confirm successful disable and enable", async () => {
  await using plugin = await copyPlugin("toggle-feedback")
  await using setup = await createAppFixture({ config: { animations: false, plugins: [plugin.directory] } })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Toggle plugin active"))

  await setup.mockInput.typeText("/plugins")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("fixture.toggle-feedback"))
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable)
  await setup.mockInput.typeText("toggle-feedback")
  await setup.waitForFrame((frame) => frame.includes("disable"))

  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) => frame.includes("Plugin fixture.toggle-feedback disabled") && frame.includes("inactive"),
  )
  expect(setup.captureCharFrame()).not.toContain("Toggle plugin active")

  setup.mockInput.pressEnter()
  await setup.waitForFrame(
    (frame) => frame.includes("Plugin fixture.toggle-feedback enabled") && frame.includes("Toggle plugin active"),
  )
  expect(setup.captureCharFrame()).not.toContain("inactive")
})
