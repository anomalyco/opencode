import { describe, expect, test } from "bun:test"
import { formatTaskbarAttentionCount } from "./taskbar-attention"

describe("taskbar attention count", () => {
  test("clears empty counts and formats visible counts", () => {
    expect(formatTaskbarAttentionCount(0)).toBeUndefined()
    expect(formatTaskbarAttentionCount(1)).toBe("1")
    expect(formatTaskbarAttentionCount(9)).toBe("9")
    expect(formatTaskbarAttentionCount(10)).toBe("10")
    expect(formatTaskbarAttentionCount(99)).toBe("99")
  })

  test("caps counts that do not fit in the overlay", () => {
    expect(formatTaskbarAttentionCount(100)).toBe("99+")
  })
})
