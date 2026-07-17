import { describe, expect, test } from "bun:test"
import { DESKTOP_MENU } from "./desktop-menu"

describe("desktop menu", () => {
  test("uses Cmd+J to toggle the terminal on macOS", () => {
    const item = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).find(
      (item) => item.type === "item" && item.command === "terminal.toggle",
    )

    expect(item).toMatchObject({ accelerator: { macos: "Cmd+J" } })
  })

  test("exports logs through the desktop command registry", () => {
    const items = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter(
      (item) => item.type === "item" && item.label === "Export Logs...",
    )

    expect(items).toHaveLength(2)
    expect(items.every((item) => item.type === "item" && item.command === "logs.export" && !item.action)).toBe(true)
  })
})
