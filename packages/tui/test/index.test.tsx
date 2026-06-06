import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src"

test("renders with OpenTUI Solid", async () => {
  const app = await testRender(() => <App />, {
    width: 20,
    height: 3,
  })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("OpenCode")
  } finally {
    app.renderer.destroy()
  }
})
