import { describe, expect, test } from "bun:test"
import { historyLoadMode, historyRevealTop } from "./history-window"

describe("historyLoadMode", () => {
  test("reveals cached turns before fetching", () => {
    expect(historyLoadMode({ start: 10, more: true, loading: false })).toBe("reveal")
  })

  test("fetches older history when cache is already revealed", () => {
    expect(historyLoadMode({ start: 0, more: true, loading: false })).toBe("fetch")
  })

  test("does nothing while history is unavailable or loading", () => {
    expect(historyLoadMode({ start: 0, more: false, loading: false })).toBe("noop")
    expect(historyLoadMode({ start: 0, more: true, loading: true })).toBe("noop")
  })
})

describe("historyRevealTop", () => {
  test("pins the viewport to the top when older turns were revealed there", () => {
    expect(historyRevealTop({ top: -400, height: 1000, gap: 0, max: 400 }, { clientHeight: 600, height: 2000 })).toBe(
      -1400,
    )
  })

  test("keeps the latest turns pinned when the viewport was underfilled", () => {
    expect(historyRevealTop({ top: 0, height: 200, gap: -400, max: -400 }, { clientHeight: 600, height: 2000 })).toBe(0)
  })

  test("keeps the current anchor when the user was not at the top", () => {
    expect(historyRevealTop({ top: -200, height: 1000, gap: 200, max: 400 }, { clientHeight: 600, height: 2000 })).toBe(
      -200,
    )
  })
})
