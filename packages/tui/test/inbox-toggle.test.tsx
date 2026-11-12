import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"

test("the palette toggles the Inbox preference without changing other session settings", async () => {
  await using app = await createAppFixture({ config: { session: { sidebar: "hide" } } })
  await app.ready
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  expect(app.captureCharFrame()).not.toContain("Inbox")

  for (const show of [true, false]) {
    app.mockInput.pressKey("p", { ctrl: true })
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
    await app.mockInput.typeText("inbox sidebar")
    await app.waitForFrame((frame) => frame.includes(`${show ? "Show" : "Hide"} Inbox sidebar`))
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => !frame.includes("Inbox sidebar") && frame.includes("Inbox") === show)
    expect(app.config().session).toEqual({ sidebar: "hide", inbox: show })

    if (show) {
      app.resize(70, 30)
      await app.waitForFrame((frame) => !frame.includes("Inbox"))
      app.resize(100, 30)
      await app.waitForFrame((frame) => frame.includes("Inbox"))
    }
  }
})
