import { describe, expect, test } from "bun:test"
import { shouldUseSessionHeaderV2 } from "./session-header-layout"

describe("shouldUseSessionHeaderV2", () => {
  test("uses the new layout accessor value", () => {
    expect(shouldUseSessionHeaderV2(() => false)).toBe(false)
    expect(shouldUseSessionHeaderV2(() => true)).toBe(true)
  })
})
