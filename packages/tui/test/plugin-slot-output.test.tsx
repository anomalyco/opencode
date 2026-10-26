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
