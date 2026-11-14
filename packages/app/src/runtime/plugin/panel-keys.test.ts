import { describe, expect, test } from "bun:test"
import { pruneTransientKeys } from "./panel-keys"

describe("pruneTransientKeys", () => {
  const transient = ["terminal:"]

  test("keeps every key while the transient panels still list theirs", () => {
    expect(pruneTransientKeys(["file:a", "terminal:1"], new Set(["file:a", "terminal:1"]), transient)).toBeUndefined()
  })

  test("keeps unlisted keys of panels that are not transient", () => {
    expect(pruneTransientKeys(["file:a"], new Set(), transient)).toBeUndefined()
  })

  test("drops an unlisted transient key and keeps the rest", () => {
    expect(pruneTransientKeys(["file:a", "terminal:1"], new Set(["file:a"]), transient)).toEqual({
      keys: ["file:a"],
      emptied: false,
    })
  })

  test("reports the strip emptied when the last stored tab was an unlisted transient one", () => {
    expect(pruneTransientKeys(["terminal:1"], new Set(), transient)).toEqual({ keys: [], emptied: true })
  })
})
