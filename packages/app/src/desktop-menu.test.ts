import { describe, expect, test } from "bun:test"
import { DEFAULT_KEYBINDS, desktopAccelerator } from "./default-keybinds"
import { DESKTOP_MENU, type DesktopMenuItem } from "./desktop-menu"

describe("desktop menu", () => {
  test("converts shared keybinds to native accelerators", () => {
    expect(desktopAccelerator("terminal.toggle", "macos")).toBe("Cmd+J")
    expect(desktopAccelerator("settings.open", "macos")).toBe("Cmd+,")
    expect(desktopAccelerator("settings.open", "windows")).toBe("Ctrl+,")
    expect(desktopAccelerator("project.previous", "macos")).toBe("Cmd+Option+Up")
  })

  test("derives command accelerators from the shared defaults", () => {
    const items = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter(
      (item): item is DesktopMenuItem & { command: keyof typeof DEFAULT_KEYBINDS } =>
        item.type === "item" && !!item.command && item.command in DEFAULT_KEYBINDS,
    )

    for (const item of items) {
      for (const [platform, accelerator] of Object.entries(item.accelerator ?? {})) {
        expect(accelerator).toBe(desktopAccelerator(item.command, platform as "macos" | "windows"))
      }
    }
  })

  test("exports logs through the desktop command registry", () => {
    const items = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter(
      (item) => item.type === "item" && item.label === "Export Logs...",
    )

    expect(items).toHaveLength(2)
    expect(items.every((item) => item.type === "item" && item.command === "logs.export" && !item.action)).toBe(true)
  })
})
