import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { json } from "./fixture/tui-client"

test("the Inbox shortcut replaces another overlay and returns to the prompt", async () => {
  await using app = await createAppFixture({ width: 150, height: 32, config: { animations: false } })
  await app.ready
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  const prompt = app.renderer.currentFocusedEditor
  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("settings")
  app.mockInput.pressKey("x", { ctrl: true })
  app.mockInput.pressKey("o")
  await app.waitForFrame(
    (frame) => frame.includes("Search inbox sessions") && app.renderer.currentFocusedEditor instanceof InputRenderable,
  )
  app.mockInput.pressKey("x", { ctrl: true })
  app.mockInput.pressKey("o")
  await app.waitFor(
    () => !app.renderer.root.findDescendantById("dialog-drawer") && app.renderer.currentFocusedEditor === prompt,
  )
})

test("the Inbox overlay opens on plugin routes without replacing them", async () => {
  await using app = await createAppFixture({
    width: 140,
    height: 30,
    config: { animations: false, keybinds: { "session.inbox.toggle": "f7" } },
    fetch: (url) =>
      url.pathname === "/api/experimental/session/stats" ? json({ message: "offline" }, { status: 503 }) : undefined,
  })
  await app.ready
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await app.mockInput.typeText("/stats")
  await app.waitForFrame((frame) => frame.includes("Usage statistics"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Could not load stats"))
  app.mockInput.pressKey("F7")
  await app.waitForFrame((frame) => frame.includes("Search inbox sessions") && frame.includes("/stats to try again"))
  app.mockInput.pressKey("F7")
  await app.waitForFrame((frame) => !frame.includes("Search inbox sessions") && frame.includes("Could not load stats"))
  expect(app.renderer.root.findDescendantById("dialog-drawer")).toBeUndefined()
})
