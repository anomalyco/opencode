import { describe, expect, test } from "bun:test"
import { treeDirsForReveal } from "./open-session-file"

describe("treeDirsForReveal", () => {
  test("expands root through target folder", () => {
    expect(treeDirsForReveal("packages/app")).toEqual(["", "packages", "packages/app"])
  })

  test("handles single segment", () => {
    expect(treeDirsForReveal("src")).toEqual(["", "src"])
  })

  test("trims trailing slash", () => {
    expect(treeDirsForReveal("packages/app/")).toEqual(["", "packages", "packages/app"])
  })
})
