import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { copyPlugin } from "./fixture/fixture"

test("a slot that renders bare text crashes only its own contribution", async () => {
  await using plugin = await copyPlugin("slot-string")
  await using setup = await createAppFixture({ config: { animations: false, plugins: [plugin.directory] } })
  await setup.ready
  await setup.waitForFrame(
    (frame) => frame.includes("Plugin still alive") && frame.includes("fixture.slot-string crashed in slot home.footer"),
  )
  expect(setup.captureCharFrame()).not.toContain("hello from a plugin")
})

test("a dialog that throws while rendering closes instead of crashing the app", async () => {
  await using plugin = await copyPlugin("dialog-throw")
  await using setup = await createAppFixture({ config: { animations: false, plugins: [plugin.directory] } })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("fixture.dialog-throw crashed in dialog"))
  // The broken dialog is closed, so focus is back in the prompt.
  await setup.mockInput.typeText("still usable")
  await setup.waitForFrame((frame) => frame.includes("still usable"))
})

// The first row of the built-in home logo.
const BUILT_IN_LOGO = "█▀▀█ █▀▀█ █▀▀█ █▀▀▄"

test("home.logo shows the built-in logo when no plugin replaces it", async () => {
  await using setup = await createAppFixture({ config: { animations: false } })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes(BUILT_IN_LOGO))
})

test("a plugin can replace the home logo through home.logo", async () => {
  await using plugin = await copyPlugin("slot-logo")
  await using setup = await createAppFixture({ config: { animations: false, plugins: [plugin.directory] } })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("ACME CODE"))
  expect(setup.captureCharFrame()).not.toContain(BUILT_IN_LOGO)
})
