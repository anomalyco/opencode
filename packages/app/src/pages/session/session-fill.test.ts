import { describe, expect, test } from "bun:test"
import { shouldFillLoad, shouldScrollLoad } from "./session-fill"

describe("shouldFillLoad", () => {
  test("returns false when historyMore is false, regardless of viewport state", () => {
    expect(shouldFillLoad({ historyMore: false, scrollHeight: 100, clientHeight: 200, messageCount: 1 })).toBe(false)
    expect(shouldFillLoad({ historyMore: false, scrollHeight: 300, clientHeight: 200, messageCount: 10 })).toBe(false)
    expect(shouldFillLoad({ historyMore: false, scrollHeight: 200, clientHeight: 200, messageCount: 0 })).toBe(false)
  })

  test("returns true when viewport is not full (scrollHeight <= clientHeight + 1)", () => {
    expect(shouldFillLoad({ historyMore: true, scrollHeight: 200, clientHeight: 200, messageCount: 0 })).toBe(true)
    expect(shouldFillLoad({ historyMore: true, scrollHeight: 201, clientHeight: 200, messageCount: 0 })).toBe(true)
    expect(shouldFillLoad({ historyMore: true, scrollHeight: 100, clientHeight: 200, messageCount: 5 })).toBe(true)
  })

  test("returns true when viewport is full but messageCount is <= 2 (fix: session switch with few messages)", () => {
    expect(shouldFillLoad({ historyMore: true, scrollHeight: 300, clientHeight: 200, messageCount: 0 })).toBe(true)
    expect(shouldFillLoad({ historyMore: true, scrollHeight: 300, clientHeight: 200, messageCount: 1 })).toBe(true)
    expect(shouldFillLoad({ historyMore: true, scrollHeight: 300, clientHeight: 200, messageCount: 2 })).toBe(true)
  })

  test("returns false when viewport is full and messageCount > 2 (normal case, no fill needed)", () => {
    expect(shouldFillLoad({ historyMore: true, scrollHeight: 300, clientHeight: 200, messageCount: 3 })).toBe(false)
    expect(shouldFillLoad({ historyMore: true, scrollHeight: 300, clientHeight: 200, messageCount: 10 })).toBe(false)
    expect(shouldFillLoad({ historyMore: true, scrollHeight: 500, clientHeight: 200, messageCount: 100 })).toBe(false)
  })
})

describe("shouldScrollLoad", () => {
  test("returns false when scrollTop >= 200", () => {
    expect(shouldScrollLoad({ scrollTop: 200, historyMore: true, historyLoading: false })).toBe(false)
    expect(shouldScrollLoad({ scrollTop: 500, historyMore: true, historyLoading: false })).toBe(false)
    expect(shouldScrollLoad({ scrollTop: 200, historyMore: true, historyLoading: false })).toBe(false)
  })

  test("returns true when scrollTop < 200 and historyMore is true and not loading", () => {
    expect(shouldScrollLoad({ scrollTop: 0, historyMore: true, historyLoading: false })).toBe(true)
    expect(shouldScrollLoad({ scrollTop: 100, historyMore: true, historyLoading: false })).toBe(true)
    expect(shouldScrollLoad({ scrollTop: 199, historyMore: true, historyLoading: false })).toBe(true)
  })

  test("returns false when historyMore is false, even at the top", () => {
    expect(shouldScrollLoad({ scrollTop: 0, historyMore: false, historyLoading: false })).toBe(false)
    expect(shouldScrollLoad({ scrollTop: 10, historyMore: false, historyLoading: false })).toBe(false)
  })

  test("returns false when historyLoading is true, even at the top", () => {
    expect(shouldScrollLoad({ scrollTop: 0, historyMore: true, historyLoading: true })).toBe(false)
    expect(shouldScrollLoad({ scrollTop: 50, historyMore: true, historyLoading: true })).toBe(false)
  })

  test("returns false when both historyMore is false and historyLoading is true", () => {
    expect(shouldScrollLoad({ scrollTop: 0, historyMore: false, historyLoading: true })).toBe(false)
  })
})