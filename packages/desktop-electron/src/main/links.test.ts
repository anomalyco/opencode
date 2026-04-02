import { describe, expect, test } from "bun:test"

import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { projectLink, projectLinks } from "./links"

describe("project links", () => {
  test("creates an open-project deep link for directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-desktop-"))

    expect(projectLink(dir)).toBe(`opencode://open-project?directory=${encodeURIComponent(dir)}`)
  })

  test("ignores files and missing paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-desktop-"))
    const file = join(dir, "note.txt")
    writeFileSync(file, "x")

    expect(projectLink(file)).toBeUndefined()
    expect(projectLink(join(dir, "missing"))).toBeUndefined()
  })

  test("collects only valid directory links", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-desktop-"))
    const file = join(dir, "note.txt")
    writeFileSync(file, "x")

    expect(projectLinks([dir, file])).toEqual([`opencode://open-project?directory=${encodeURIComponent(dir)}`])
  })
})
