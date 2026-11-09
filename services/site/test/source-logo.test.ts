import { describe, expect, test } from "bun:test"
// Every language, as the Worker registers them at startup.
import "../src/i18n/server"
import { siteLinks } from "../src/component/site/links"
import { navDefaults } from "../src/component/site/settings"
import { translator } from "../src/i18n"
import { forHumansRows } from "../src/lib/source-logo-nav"

// source-logo.ts reads its build line with Vite's import.meta.glob, which Bun can't run, so this
// checks its template text and the rows it interpolates.
const source = await Bun.file(new URL("../src/lib/source-logo.ts", import.meta.url)).text()
const rows = forHumansRows().split("\n")
const nav = siteLinks(translator("en"), (path) => path).nav
const shown = navDefaults.filter((entry) => entry.visible).map((entry) => nav.find((item) => item.id === entry.id)!)

describe("view-source comment", () => {
  test("FOR HUMANS is built from the nav data", () => {
    expect(source).toContain("  FOR HUMANS\n${forHumans}\n")
  })

  test("FOR HUMANS starts with the main nav in its default order", () => {
    const first = rows.slice(0, shown.length).map((row) =>
      row
        .trim()
        .split(/\s{2,}/)
        .slice(0, 2),
    )
    expect(first).toEqual(shown.map((item) => [`├── ${item.label}`, item.href]))
  })

  test("FOR HUMANS rows line up and contain no --", () => {
    const described = rows.map((row) => row.trim().split(/\s{2,}/)).filter((parts) => parts.length > 2)
    const column = (parts: string[]) => rows.find((row) => row.includes(parts[0]))!.indexOf(parts[2])
    expect(new Set(described.map(column)).size).toBe(1)
    expect(rows.some((row) => row.includes("--"))).toBe(false)
  })
})
