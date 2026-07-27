import { describe, expect, test } from "bun:test"
import { nextTab, previousTab, rememberTab, type TabHistory } from "./tab-history"

function history(): TabHistory {
  return { stack: [], index: -1 }
}

describe("tab history", () => {
  test("moves backward and forward through selected tabs", () => {
    const selected = ["a", "b", "c"].reduce(rememberTab, history())
    const available = new Set(selected.stack)

    const previous = previousTab(selected, available)
    expect(previous?.key).toBe("b")

    const first = previousTab(previous!.state, available)
    expect(first?.key).toBe("a")

    const next = nextTab(first!.state, available)
    expect(next?.key).toBe("b")
  })

  test("replaces forward history after a new selection", () => {
    const selected = ["a", "b", "c"].reduce(rememberTab, history())
    const previous = previousTab(selected, new Set(selected.stack))
    const next = rememberTab(previous!.state, "d")

    expect(next).toEqual({ stack: ["a", "b", "d"], index: 2 })
    expect(nextTab(next, new Set(next.stack))).toBeUndefined()
  })

  test("skips tabs that are no longer open", () => {
    const selected = ["a", "b", "c"].reduce(rememberTab, history())

    expect(previousTab(selected, new Set(["a", "c"]))?.key).toBe("a")
  })

  test("skips a repeated current tab after closing the previous selection", () => {
    const selected = ["a", "b", "c", "b"].reduce(rememberTab, history())

    expect(previousTab(selected, new Set(["a", "b"]))?.key).toBe("a")
  })
})
