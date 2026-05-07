import { describe, expect, test } from "bun:test"
import { getHashTargetHistoryAction } from "./use-session-hash-scroll"

describe("getHashTargetHistoryAction", () => {
  test("keeps visible targets in place", () => {
    expect(getHashTargetHistoryAction("m2", ["m1", "m2", "m3"], ["m1", "m2"])).toBe("present")
  })

  test("loads older history for targets before the loaded range", () => {
    expect(getHashTargetHistoryAction("m1", ["m3", "m4"], ["m3", "m4"])).toBe("load-more")
  })

  test("clears targets that are already loaded but hidden by a revert", () => {
    expect(getHashTargetHistoryAction("m4", ["m2", "m3", "m4"], ["m2", "m3"])).toBe("clear")
  })

  test("clears impossible targets inside or after the loaded range", () => {
    expect(getHashTargetHistoryAction("m5", ["m2", "m3", "m4"], ["m2", "m3", "m4"])).toBe("clear")
    expect(getHashTargetHistoryAction("m3.5", ["m2", "m4"], ["m2", "m4"])).toBe("clear")
  })

  test("keeps loading when no user-message history is loaded yet", () => {
    expect(getHashTargetHistoryAction("m9", [], [])).toBe("load-more")
  })
})
