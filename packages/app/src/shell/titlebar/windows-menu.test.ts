import { describe, expect, test } from "bun:test"
import { DESKTOP_MENU } from "@/shell/commands/desktop-menu"
import { windowsMenuAccelerator } from "./windows-menu"

describe("Windows app menu", () => {
  test("resolves the new window accelerator", () => {
    expect(windowsMenuAccelerator(new KeyboardEvent("keydown", { key: "N", ctrlKey: true, shiftKey: true }))).toBe(
      "window.new",
    )
  })

  test("leaves select all to the focused browser editor", () => {
    expect(windowsMenuAccelerator(new KeyboardEvent("keydown", { key: "a", ctrlKey: true }))).toBeUndefined()
    expect(windowsMenuAccelerator(new KeyboardEvent("keydown", { key: "A", ctrlKey: true }))).toBeUndefined()
  })

  test("ignores the accelerator without its modifiers", () => {
    expect(windowsMenuAccelerator(new KeyboardEvent("keydown", { key: "N" }))).toBeUndefined()
  })

  test.each(["v", "c", "x", "a", "z", "y"])("leaves Ctrl+%s to the focused editor", (key) => {
    expect(windowsMenuAccelerator(new KeyboardEvent("keydown", { key, ctrlKey: true }))).toBeUndefined()
  })

  test("preserves the paste menu action and shortcut label", () => {
    expect(
      DESKTOP_MENU.flatMap((menu) => menu.items ?? []).find(
        (entry) => entry.type === "item" && entry.action === "edit.paste",
      ),
    ).toMatchObject({ action: "edit.paste", accelerator: { windows: "Ctrl+V" } })
  })
})
