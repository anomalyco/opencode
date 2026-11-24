import { describe, expect, test } from "bun:test"
import { KEPT_PLACES, keepPlace, placeOf, resolvePlace, takePlace, type Place } from "./place"

// The reader is 40px into row e, with four rows remembered on each side.
const place: Place = { key: "e", offset: 40, after: ["f", "g", "h", "i"], before: ["d", "c", "b", "a"] }

describe("a place in the rows a session has now", () => {
  test.each([
    { name: "its own row", keys: "abcdefghi", target: { type: "row", row: 4, offset: 40 } },
    {
      name: "its own row after rows arrived above it",
      keys: "xyabcdefghi",
      target: { type: "row", row: 6, offset: 40 },
    },
    {
      name: "the start of the next row when its row is gone",
      keys: "abcdfghi",
      target: { type: "row", row: 4, offset: 0 },
    },
    { name: "the nearest row after it that is left", keys: "abcdhi", target: { type: "row", row: 4, offset: 0 } },
    {
      name: "the row after the nearest one before it when no remembered row after it is left",
      keys: "abcdxy",
      target: { type: "row", row: 4, offset: 0 },
    },
    { name: "the end when what is left of the session ends before it", keys: "abcd", target: { type: "end" } },
    { name: "the end when no remembered row is left", keys: "xyz", target: { type: "end" } },
  ])("is $name", (input) => {
    expect(resolvePlace(place, input.keys.split(""))).toEqual(input.target)
  })
})

describe("the places kept for sessions", () => {
  test("hands a place over once", () => {
    keepPlace("once", place)
    expect(placeOf("once")).toBe(place)
    expect(takePlace("once")).toBe(place)
    expect(placeOf("once")).toBeUndefined()
  })

  test("keeps no place for a reader who went back to following", () => {
    keepPlace("followed", place)
    keepPlace("followed", undefined)
    expect(placeOf("followed")).toBeUndefined()
  })

  test("lets the place kept longest ago go once more sessions than the bound have one", () => {
    const sessions = Array.from({ length: KEPT_PLACES + 1 }, (_, index) => `bound-${index}`)
    keepPlace(sessions[0]!, place)
    keepPlace(sessions[1]!, place)
    // Kept again: the first session's place is now the newest.
    keepPlace(sessions[0]!, place)
    sessions.slice(2).forEach((session) => keepPlace(session, place))

    expect(placeOf(sessions[0]!)).toBe(place)
    expect(placeOf(sessions[1]!)).toBeUndefined()
    expect(sessions.slice(2).every((session) => placeOf(session) === place)).toBe(true)
    sessions.forEach(takePlace)
  })
})
