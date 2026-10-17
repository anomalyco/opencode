import { describe, expect, test } from "bun:test"
import { addPin, removePin } from "./pinned-list"

describe("pinned message list", () => {
  test("adds a new pin newest first", () => {
    expect(addPin(["a", "b"], "c")).toEqual(["c", "a", "b"])
    expect(addPin([], "a")).toEqual(["a"])
  })

  test("re-adding a pin moves it to the front without duplicating", () => {
    expect(addPin(["a", "b", "c"], "c")).toEqual(["c", "a", "b"])
    expect(addPin(["c", "a", "b"], "c")).toEqual(["c", "a", "b"])
  })

  test("removes a pin and keeps the order of the rest", () => {
    expect(removePin(["a", "b", "c"], "b")).toEqual(["a", "c"])
    expect(removePin(["a"], "z")).toEqual(["a"])
  })

  test("keeps the newest pins when the list overflows", () => {
    const pins = Array.from({ length: 100 }, (_, index) => `pin-${index}`)

    const next = addPin(pins, "newest")

    expect(next).toHaveLength(100)
    expect(next[0]).toBe("newest")
    expect(next).not.toContain("pin-99")
  })
})
