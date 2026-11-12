import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"

test("disabling the built-in Inbox removes its rail, shortcut and palette command", async () => {
  await using app = await createAppFixture({
    config: {
      animations: false,
      session: { inbox: true },
      plugins: ["-opencode.inbox"],
      keybinds: { "session.inbox.toggle": "f6" },
    },
  })
  await app.ready
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  expect(app.captureCharFrame()).not.toContain("Inbox")
  app.mockInput.pressKey("F6")
  await app.renderOnce()
  expect(app.config().session?.inbox).toBe(true)
  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("Inbox")
  await app.renderOnce()
  expect(app.captureCharFrame()).not.toMatch(/(Open Inbox|Hide Inbox sidebar|Show Inbox sidebar|Focus Inbox)/)
})
