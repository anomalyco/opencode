import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { DESKTOP_MENU, type DesktopMenuEntry } from "./desktop-menu"

function entries(items: DesktopMenuEntry[]): DesktopMenuEntry[] {
  return items.flatMap((item) => ("items" in item ? entries(item.items) : [item]))
}

describe("desktop menu", () => {
  test("exports logs through the desktop command registry", () => {
    const items = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).filter(
      (item) => item.type === "item" && item.label === "Export Logs...",
    )

    expect(items).toHaveLength(2)
    expect(items.every((item) => item.type === "item" && item.command === "logs.export" && !item.action)).toBe(true)
  })

  test("GitHub issue links reference existing issue templates", () => {
    const templateDir = path.resolve(import.meta.dir, "../../../.github/ISSUE_TEMPLATE")
    const issueLinks = entries(DESKTOP_MENU.flatMap((menu) => menu.items)).filter(
      (item) => "href" in item && item.href.startsWith("https://github.com/anomalyco/opencode/issues/new"),
    )

    expect(issueLinks.length).toBeGreaterThan(0)
    for (const item of issueLinks) {
      if (!("href" in item)) continue
      const template = new URL(item.href).searchParams.get("template")
      expect(template).toBeTruthy()
      expect(existsSync(path.join(templateDir, template ?? ""))).toBe(true)
    }
  })
})
