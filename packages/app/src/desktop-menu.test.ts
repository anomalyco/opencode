import { describe, expect, test } from "bun:test"
import { DESKTOP_MENU, desktopRecentProjectCommand } from "./desktop-menu"

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

  test("places recent projects directly below open project", () => {
    const file = DESKTOP_MENU.find((menu) => menu.id === "file")
    const open = file?.items?.findIndex((item) => item.type === "item" && item.command === "project.open") ?? -1
    const recent = file?.items?.findIndex((item) => item.type === "item" && item.dynamic === "recentProjects") ?? -1

    expect(open).toBeGreaterThanOrEqual(0)
    expect(recent).toBe(open + 1)
  })

  test("creates distinct recent project commands", () => {
    expect(desktopRecentProjectCommand("server:a", "/code/one")).not.toBe(
      desktopRecentProjectCommand("server:a", "/code/two"),
    )
  })
})
