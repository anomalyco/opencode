import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { json } from "./fixture/tui-client"

test("the leader replaces another overlay without changing the prompt", async () => {
  await using app = await createAppFixture({ width: 150, height: 30, config: { animations: false } })
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
  const ready = () =>
    app.waitForFrame(
      (frame) =>
        frame.includes("Search inbox sessions") && app.renderer.currentFocusedEditor instanceof InputRenderable,
    )

  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("settings")
  toggle()
  await ready()
  const drawer = app.renderer.root.findDescendantById("dialog-drawer")!
  expect([drawer.x, drawer.width, drawer.height]).toEqual([0, 75, 30])
  expect(bounds()).toEqual(original)
  await app.mockInput.typeText("filter only")
  expect(prompt.plainText).toBe(draft)
  toggle()
  await until(
    () => !app.renderer.root.findDescendantById("dialog-drawer") && app.renderer.currentFocusedEditor === prompt,
  )
  expect(app.config().session?.inbox).toBeUndefined()
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
  await until(
    () =>
      !app.renderer.root.findDescendantById("dialog-drawer") &&
      !app.renderer.getSelection() &&
      app.renderer.currentFocusedEditor === prompt,
  )
})

test("settings, launch, remapping, palette and plugin routes use the same overlay", async () => {
  await using app = await createAppFixture({
    width: 50,
    height: 24,
    config: {
      animations: false,
      session: { inbox: true },
      keybinds: { "opencode.settings": "f5", "session.inbox.toggle": "f6" },
    },
    fetch: (url) =>
      url.pathname === "/api/experimental/session/stats" ? json({ message: "offline" }, { status: 503 }) : undefined,
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

  app.mockInput.pressKey("F5")
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("Inbox")
  await app.waitForFrame((frame) => /Open Inbox on launch +on/.test(frame))
  expect(app.captureCharFrame()).not.toContain("Inbox layout")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => /Open Inbox on launch +off/.test(frame))
  expect(app.config().session).toEqual({ inbox: false })
  app.mockInput.pressEscape()
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)

  app.mockInput.pressKey("F6")
  await ready()
  app.mockInput.pressEscape()
  await app.waitFor(() => !drawer() && app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  app.resize(100, 24)
  await app.renderOnce()
  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("Open Inbox")
  await app.waitForFrame((frame) => frame.includes("Open Inbox"))
  app.mockInput.pressEnter()
  await ready()
  expect(drawer()?.width).toBe(56)
  await app.mockMouse.click(94, 2)
  await app.waitForFrame(() => !drawer() && app.renderer.currentFocusedEditor instanceof TextareaRenderable)

  app.resize(140, 24)
  await app.renderOnce()
  app.mockInput.pressKey("u", { ctrl: true })
  await app.mockInput.typeText("/stats")
  await app.waitForFrame((frame) => frame.includes("Usage statistics"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Could not load stats"))
  app.mockInput.pressKey("F6")
  await app.waitForFrame((frame) => frame.includes("Search inbox sessions") && frame.includes("/stats to try again"))
  app.mockInput.pressKey("F6")
  await app.waitForFrame((frame) => !frame.includes("Search inbox sessions") && frame.includes("Could not load stats"))
})

async function until(check: () => boolean) {
  const deadline = Date.now() + 2_000
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for Inbox focus")
    await Bun.sleep(10)
  }
}

test("disabling the built-in Inbox removes its launch overlay, shortcut and palette command", async () => {
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
  expect(app.captureCharFrame()).not.toContain("Search inbox sessions")
  app.mockInput.pressKey("F6")
  await app.renderOnce()
  expect(app.captureCharFrame()).not.toContain("Search inbox sessions")
  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("Inbox")
  await app.renderOnce()
  expect(app.captureCharFrame()).not.toMatch(/Open Inbox(?! on launch)/)
})
