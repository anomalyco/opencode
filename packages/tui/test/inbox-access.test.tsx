import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { json } from "./fixture/tui-client"

test("toggling the sidebar leaves an open dialog and its filter focused", async () => {
  await using app = await createAppFixture({
    width: 150,
    height: 32,
    config: { animations: false, session: { inbox: false } },
  })
  await app.ready
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  const prompt = app.renderer.currentFocusedEditor
  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  const filter = app.renderer.currentFocusedEditor!
  await app.mockInput.typeText("settings")
  for (const visible of [true, false]) {
    app.mockInput.pressKey("x", { ctrl: true })
    app.mockInput.pressKey("o")
    await app.waitFor(() => !!app.renderer.root.findDescendantById("inbox-sidebar") === visible)
    expect(app.renderer.currentFocusedEditor).toBe(filter)
    expect(filter.plainText).toBe("settings")
  }
  app.mockInput.pressEscape()
  await app.waitFor(() => app.renderer.currentFocusedEditor === prompt)
})

test("narrow sidebar mode opens a temporary drawer without changing the wide preference", async () => {
  await using app = await createAppFixture({
    width: 65,
    height: 24,
    config: { animations: false, session: { inbox: true } },
  })
  await app.ready
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  const prompt = app.renderer.currentFocusedEditor
  const toggle = () => {
    app.mockInput.pressKey("x", { ctrl: true })
    app.mockInput.pressKey("o")
  }
  toggle()
  await app.waitForFrame(
    (frame) => frame.includes("Search inbox sessions") && app.renderer.currentFocusedEditor instanceof InputRenderable,
  )
  app.resize(140, 30)
  await app.renderOnce()
  toggle()
  await app.waitFor(
    () => !app.renderer.root.findDescendantById("dialog-drawer") && app.renderer.currentFocusedEditor === prompt,
  )
  expect(app.renderer.root.findDescendantById("inbox-sidebar")).toBeDefined()
  expect(app.config().session).toEqual({ inbox: true })
})

test("the Inbox stays mounted across plugin navigation and toggles on the plugin route", async () => {
  await using app = await createAppFixture({
    width: 140,
    height: 30,
    config: { animations: false, session: { inbox: true }, keybinds: { "session.inbox.toggle": "f7" } },
    fetch: (url) =>
      url.pathname === "/api/experimental/session/stats" ? json({ message: "offline" }, { status: 503 }) : undefined,
  })
  await app.ready
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  const sidebar = app.renderer.root.findDescendantById("inbox-sidebar")
  expect(sidebar).toBeDefined()
  app.mockInput.pressKey("u", { ctrl: true })
  await app.mockInput.typeText("/stats")
  await app.waitForFrame((frame) => frame.includes("Usage statistics"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Could not load stats"))
  expect(app.renderer.root.findDescendantById("inbox-sidebar")).toBe(sidebar)
  for (const visible of [false, true]) {
    app.mockInput.pressKey("F7")
    await app.waitFor(() => !!app.renderer.root.findDescendantById("inbox-sidebar") === visible)
    expect(app.captureCharFrame()).toContain("Could not load stats")
  }
  app.mockInput.pressEscape()
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
})
