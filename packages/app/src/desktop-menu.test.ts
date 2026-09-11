import { describe, expect, test } from "bun:test"
import { DESKTOP_MENU } from "./desktop-menu"

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

  test("keeps the Windows Side Chat shortcut clear of the New Window menu item", () => {
    const item = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).find(
      (entry) => entry.type === "item" && entry.action === "window.new",
    )

    expect(item?.type === "item" && item.accelerator?.windows).toBeUndefined()
    expect(item?.type === "item" && item.accelerator?.macos).toBe("Cmd+Shift+N")
  })
})
