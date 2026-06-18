import { describe, expect, test } from "bun:test"
import { SESSION_FILTER_MODES, isSessionFilterMode, nextSessionFilterMode } from "../../../src/context/sync"

describe("isSessionFilterMode", () => {
  test("accepts every known mode", () => {
    for (const mode of SESSION_FILTER_MODES) expect(isSessionFilterMode(mode)).toBe(true)
  })

  test("rejects unknown strings and non-string values", () => {
    expect(isSessionFilterMode("global")).toBe(false)
    expect(isSessionFilterMode(undefined)).toBe(false)
    expect(isSessionFilterMode(null)).toBe(false)
    expect(isSessionFilterMode(true)).toBe(false)
  })
})

describe("nextSessionFilterMode", () => {
  test("cycles hierarchical -> directory -> project -> hierarchical", () => {
    expect(nextSessionFilterMode("hierarchical")).toBe("directory")
    expect(nextSessionFilterMode("directory")).toBe("project")
    expect(nextSessionFilterMode("project")).toBe("hierarchical")
  })
})
