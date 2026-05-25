import { describe, expect, test } from "bun:test"
import { findDirectoryCompletionRow } from "./dialog-select-directory"

describe("dialog select directory", () => {
  test("tab completion skips the parent row and uses the first directory", () => {
    const row = findDirectoryCompletionRow(
      [
        { type: "up", key: "up", name: "..", path: "/Users/" },
        { type: "directory", key: "/Users/lelouch", name: "lelouch", path: "/Users/lelouch" },
        { type: "directory", key: "/Users/shared", name: "shared", path: "/Users/shared" },
      ],
      0,
    )

    expect(row).toEqual({ type: "directory", key: "/Users/lelouch", name: "lelouch", path: "/Users/lelouch" })
  })

  test("tab completion prefers the highlighted directory", () => {
    const row = findDirectoryCompletionRow(
      [
        { type: "up", key: "up", name: "..", path: "/Users/" },
        { type: "directory", key: "/Users/lelouch", name: "lelouch", path: "/Users/lelouch" },
        { type: "directory", key: "/Users/shared", name: "shared", path: "/Users/shared" },
      ],
      2,
    )

    expect(row).toEqual({ type: "directory", key: "/Users/shared", name: "shared", path: "/Users/shared" })
  })
})
