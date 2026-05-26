import { describe, expect, test } from "bun:test"
import { resolveOpenPathTarget } from "./session-header-path"

describe("resolveOpenPathTarget", () => {
  test("opens the selected relative file inside the project directory", () => {
    expect(resolveOpenPathTarget({ projectDirectory: "/repo", selectedFilePath: "src/app.ts" })).toBe(
      "/repo/src/app.ts",
    )
  })

  test("keeps absolute selected files unchanged", () => {
    expect(resolveOpenPathTarget({ projectDirectory: "/repo", selectedFilePath: "/repo/src/app.ts" })).toBe(
      "/repo/src/app.ts",
    )
  })

  test("falls back to the project directory without a selected file", () => {
    expect(resolveOpenPathTarget({ projectDirectory: "/repo" })).toBe("/repo")
  })
})
