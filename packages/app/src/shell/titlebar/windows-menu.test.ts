import { expect, test } from "bun:test"
import { windowsMenuAccelerator } from "./windows-menu"

test("resolves the new window accelerator only with its modifiers", () => {
  expect(windowsMenuAccelerator(new KeyboardEvent("keydown", { key: "N", ctrlKey: true, shiftKey: true }))).toBe(
    "window.new",
  )
  expect(windowsMenuAccelerator(new KeyboardEvent("keydown", { key: "N" }))).toBeUndefined()
})

test.each(["v", "c", "x", "a", "A", "z", "y"])("leaves Ctrl+%s to the focused editor", (key) => {
  expect(windowsMenuAccelerator(new KeyboardEvent("keydown", { key, ctrlKey: true }))).toBeUndefined()
})
