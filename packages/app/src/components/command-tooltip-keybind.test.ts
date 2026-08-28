import { describe, expect, test } from "bun:test"
import { newTabTooltipKeybind, reviewTooltipKeybind } from "./command-tooltip-keybind"

describe("command tooltip keybinds", () => {
  test("keeps localized review shortcut modifiers", () => {
    const command = {
      keybind: () => "Ctrl+Maj+R",
      keybindParts: () => ["Ctrl", "Maj", "R"],
    }

    expect(reviewTooltipKeybind(command, (key) => key)).toEqual(["Ctrl", "Maj", "R"])
  })

  test("uses the configured new-tab shortcut", () => {
    const command = {
      keybind: () => "Alt+N",
      keybindParts: () => ["Alt", "N"],
    }

    expect(newTabTooltipKeybind(command, (key) => key)).toEqual(["Alt", "N"])
  })
})
