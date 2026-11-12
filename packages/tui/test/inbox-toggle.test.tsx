import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"

test("changing Inbox layout in settings switches the same shortcut from sidebar to drawer", async () => {
  await using app = await createAppFixture({
    config: {
      animations: false,
      session: { inbox: true },
      keybinds: { "opencode.settings": "f5", "session.inbox.toggle": "f6" },
    },
  })
  await app.ready
  await app.waitForFrame(
    (frame) => frame.includes("Inbox") && app.renderer.currentFocusedEditor instanceof TextareaRenderable,
  )
  const prompt = app.renderer.currentFocusedEditor!
  app.mockInput.pressKey("F5")
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("Inbox layout")
  await app.waitForFrame((frame) => /Inbox layout +sidebar/.test(frame))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => /Inbox layout +side-overlay/.test(frame))
  expect(app.config().session).toEqual({ inbox: true, inbox_layout: "side-overlay" })
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => !frame.includes("Inbox") && app.renderer.currentFocusedEditor === prompt)
  app.mockInput.pressKey("F6")
  await app.waitForFrame((frame) => frame.includes("Search inbox sessions"))
  app.mockInput.pressKey("F6")
  await app.waitFor(() => app.renderer.currentFocusedEditor === prompt)
  expect(app.config().session?.inbox).toBe(true)
})

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
