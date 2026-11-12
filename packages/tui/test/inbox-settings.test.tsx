import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"

test("Inbox settings only choose whether the overlay opens on launch", async () => {
  await using app = await createAppFixture({
    config: { animations: false, keybinds: { "opencode.settings": "f5" } },
  })
  await app.ready
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  app.mockInput.pressKey("F5")
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("Inbox")
  await app.waitForFrame((frame) => /Open Inbox on launch +off/.test(frame))
  expect(app.captureCharFrame()).not.toContain("Inbox layout")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => /Open Inbox on launch +on/.test(frame))
  expect(app.config().session).toEqual({ inbox: true })
})
