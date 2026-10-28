import { test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { copyPlugin } from "./fixture/fixture"

// A plugin crash replaces the slot, so neither line renders.
test("a plugin draws Markdown with a syntax style that the renderer owns and reads a declared layout style", async () => {
  await using plugin = await copyPlugin("native-resources")
  await using setup = await createAppFixture({ config: { animations: false, plugins: [plugin.directory] } })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Plugin markdown ready") && frame.includes("Plugin padding 2"))
})
