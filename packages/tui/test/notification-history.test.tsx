import { expect, test } from "bun:test"
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory } from "./fixture/tui-client"

test.each(["keybind", "slash", "palette"] as const)("notification history opens from the full TUI (%s)", async (entry) => {
  await using state = await tmpdir()
  await using app = await createAppFixture({
    state: state.path,
    config: { animations: false, keybinds: { "notification.history": "f8" } },
  })
  await app.ready
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  app.events.emit({
    id: "evt_toast",
    created: 1,
    type: "tui.toast.show",
    location: { directory },
    data: { title: "Review notice", message: "A missed server notification", variant: "warning", duration: 500 },
  })
  await app.waitForFrame((frame) => frame.includes("A missed server notification"))
  await app.waitForFrame((frame) => !frame.includes("A missed server notification"))
  if (entry === "keybind") app.mockInput.pressKey("F8")
  if (entry === "slash") {
    await app.mockInput.typeText("/notifications")
    await app.waitForFrame((frame) => frame.includes("Notification history"))
    app.mockInput.pressEnter()
  }
  if (entry === "palette") {
    app.mockInput.pressKey("p", { ctrl: true })
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
    await app.mockInput.typeText("Notification history")
    await app.waitForFrame((frame) => frame.includes("Notification history"))
    app.mockInput.pressEnter()
  }
  await app.waitForFrame((frame) => frame.includes("Notification history") && frame.includes("Review notice"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("enter back") && frame.includes("A missed server notification"))
  expect(app.captureCharFrame()).toContain("warning")
})
