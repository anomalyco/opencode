import { describe, expect, test } from "bun:test"
import { canAddSelectionContext } from "./session-command-helpers"

describe("canAddSelectionContext", () => {
  test("returns false without active tab", () => {
    expect(
      canAddSelectionContext({
        active: undefined,
        pathFromTab: () => "src/a.ts",
        selectedLines: () => ({ start: 1, end: 1 }),
      }),
    ).toBe(false)
  })

  test("returns false when active tab is not a file", () => {
    expect(
      canAddSelectionContext({
        active: "context",
        pathFromTab: () => undefined,
        selectedLines: () => ({ start: 1, end: 1 }),
      }),
    ).toBe(false)
  })

  test("returns false without selected lines", () => {
    expect(
      canAddSelectionContext({
        active: "file://src/a.ts",
        pathFromTab: () => "src/a.ts",
        selectedLines: () => null,
      }),
    ).toBe(false)
  })

  test("returns true when file and selection exist", () => {
    expect(
      canAddSelectionContext({
        active: "file://src/a.ts",
        pathFromTab: () => "src/a.ts",
        selectedLines: () => ({ start: 1, end: 2 }),
      }),
    ).toBe(true)
  })
})
