import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"

test("the leader opens and dismisses the overlay without changing prompt text, focus or layout", async () => {
  await using app = await createAppFixture({
    width: 150,
    height: 30,
    config: { animations: false, session: {} },
  })
  await app.ready
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  const prompt = app.renderer.currentFocusedEditor!
  await app.mockInput.typeText("unfinished draft")
  await app.renderOnce()
  const draft = prompt.plainText
  const bounds = () => [prompt.x, prompt.y, prompt.width, prompt.height]
  const original = bounds()
  const toggle = () => {
    app.mockInput.pressKey("x", { ctrl: true })
    app.mockInput.pressKey("o")
  }
  toggle()
  await app.waitForFrame(
    (frame) => frame.includes("Search inbox sessions") && app.renderer.currentFocusedEditor instanceof InputRenderable,
  )
  const drawer = app.renderer.root.findDescendantById("dialog-drawer")!
  expect([drawer.x, drawer.width, drawer.height]).toEqual([0, 75, 30])
  expect(bounds()).toEqual(original)
  await app.mockInput.typeText("filter only")
  expect(prompt.plainText).toBe(draft)
  toggle()
  await app.waitFor(() => app.renderer.currentFocusedEditor === prompt)
  expect(app.renderer.root.findDescendantById("dialog-drawer")).toBeUndefined()
  expect(app.config().session?.inbox).toBeUndefined()
  app.mockInput.pressKey("u", { ctrl: true })
  await app.waitFor(() => prompt.plainText === "")
})

test("Escape closes the overlay before filter text or a selection consumes it", async () => {
  await using app = await createAppFixture({ width: 100, height: 24, config: { animations: false } })
  await app.ready
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  const prompt = app.renderer.currentFocusedEditor
  app.mockInput.pressKey("x", { ctrl: true })
  app.mockInput.pressKey("o")
  await app.waitForFrame(
    (frame) => frame.includes("Search inbox sessions") && app.renderer.currentFocusedEditor instanceof InputRenderable,
  )
  await app.mockInput.typeText("draft")
  const y = app
    .captureCharFrame()
    .split("\n")
    .findIndex((line) => line.includes("Inbox"))
  await app.mockMouse.drag(1, y, 5, y)
  await app.waitFor(() => app.renderer.getSelection()?.getSelectedText() === "Inbox")
  app.mockInput.pressEscape()
  await app.waitFor(
    () =>
      !app.renderer.root.findDescendantById("dialog-drawer") &&
      !app.renderer.getSelection() &&
      app.renderer.currentFocusedEditor === prompt,
  )
})

test("the launch preference, remapped shortcut and palette open the same responsive overlay", async () => {
  await using app = await createAppFixture({
    width: 50,
    height: 24,
    config: {
      animations: false,
      session: { inbox: true },
      keybinds: { "session.inbox.toggle": "f6" },
    },
  })
  await app.ready
  const drawer = () => app.renderer.root.findDescendantById("dialog-drawer")
  const ready = () =>
    app.waitForFrame(
      (frame) =>
        frame.includes("Search inbox sessions") && app.renderer.currentFocusedEditor instanceof InputRenderable,
    )
  await ready()
  expect(drawer()?.width).toBe(50)
  app.mockInput.pressEscape()
  await app.waitFor(() => !drawer() && app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  app.resize(100, 24)
  await app.renderOnce()
  app.mockInput.pressKey("F6")
  await ready()
  expect(drawer()?.width).toBe(56)
  await app.mockMouse.click(94, 2)
  await app.waitForFrame(() => !drawer() && app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("Open Inbox")
  await app.waitForFrame((frame) => frame.includes("Open Inbox"))
  app.mockInput.pressEnter()
  await ready()
  app.mockInput.pressEscape()
  await app.waitFor(() => !drawer() && app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  expect(app.config().session?.inbox).toBe(true)
})
