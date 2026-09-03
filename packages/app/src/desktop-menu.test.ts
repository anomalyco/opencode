import { describe, expect, test } from "bun:test"
import { matchKeybind, parseKeybind } from "./context/command"
import {
  DESKTOP_MENU,
  desktopMenuAcceleratorKeybind,
  desktopMenuActionBinds,
} from "./desktop-menu"

describe("desktop menu", () => {
  test("exports logs through the desktop command registry", () => {
    const items = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter(
      (item) => item.type === "item" && item.labelKey === "desktop.menu.exportLogs",
    )

    expect(items).toHaveLength(2)
    expect(items.every((item) => item.type === "item" && item.command === "logs.export" && !item.action)).toBe(true)
  })

  test("provides translated labels for role-backed entries", () => {
    const windowMenu = DESKTOP_MENU.find((menu) => menu.role === "windowMenu")
    const roleItems = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter(
      (item) => item.type === "item" && item.role && item.labelKey,
    )

    expect(windowMenu?.labelKey).toBe("desktop.menu.window")
    expect(roleItems.length).toBeGreaterThan(0)
  })

  test("desktopMenuActionBinds exposes action accelerators for the in-app menu", () => {
    const binds = desktopMenuActionBinds("windows")

    expect(binds.map((bind) => bind.action)).toContain("window.new")
    expect(binds.find((bind) => bind.action === "window.new")?.accelerator).toBe("Ctrl+Shift+N")
    expect(binds.find((bind) => bind.action === "view.zoomIn")).toBeUndefined()
  })

  test("desktopMenuAcceleratorKeybind feeds the command keybind matcher", () => {
    const bind = desktopMenuActionBinds("windows").find((entry) => entry.action === "window.new")
    expect(bind).toBeDefined()

    const keybind = desktopMenuAcceleratorKeybind(bind!.accelerator)
    expect(keybind).toBe("ctrl+shift+n")
    expect(
      matchKeybind(keybinds(keybind), new KeyboardEvent("keydown", { key: "n", ctrlKey: true, shiftKey: true })),
    ).toBe(true)
    expect(matchKeybind(keybinds(keybind), new KeyboardEvent("keydown", { key: "n", ctrlKey: true }))).toBe(false)
  })

  test("desktopMenuAcceleratorKeybind normalizes punctuation and aliases", () => {
    expect(desktopMenuAcceleratorKeybind("Ctrl+,")).toBe("ctrl+comma")
    expect(desktopMenuAcceleratorKeybind("Cmd+Shift+N")).toBe("mod+shift+n")
    expect(desktopMenuAcceleratorKeybind("Cmd+Option+Up")).toBe("mod+alt+up")
    expect(desktopMenuAcceleratorKeybind("Ctrl+`")).toBe("ctrl+`")
  })
})

function keybinds(config: string) {
  return parseKeybind(config)
}
