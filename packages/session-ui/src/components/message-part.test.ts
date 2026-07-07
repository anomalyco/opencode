import { describe, expect, test } from "bun:test"
import { taskSessionIdFromMetadata } from "./message-part-task"
import { readPartText } from "./message-part-text"

describe("taskSessionIdFromMetadata", () => {
  test("uses state metadata when available", () => {
    expect(taskSessionIdFromMetadata({ sessionId: "child-1" }, { sessionId: "child-2" })).toBe("child-1")
  })

  test("falls back to top-level part metadata for cancelled task cards", () => {
    expect(taskSessionIdFromMetadata(undefined, { sessionId: "child-1" })).toBe("child-1")
  })

  test("accepts legacy sessionID casing", () => {
    expect(taskSessionIdFromMetadata({}, { sessionID: "child-1" })).toBe("child-1")
  })
})

describe("readPartText", () => {
  test("returns empty string when accum is undefined and part text is undefined", () => {
    expect(readPartText(undefined, { id: "part_1" })).toBe("")
  })

  test("returns trimmed part text when accum is undefined", () => {
    expect(readPartText(undefined, { id: "part_1", text: "  hello  " })).toBe("hello")
  })

  test("prefers accum value over part text when accum has a hit", () => {
    expect(readPartText({ part_1: "  from accum  " }, { id: "part_1", text: "from part" })).toBe("from accum")
  })

  test("falls back to part text when accum misses", () => {
    expect(readPartText({ other_part: "ignored" }, { id: "part_1", text: "  from part  " })).toBe("from part")
  })

  test("returns empty string for whitespace-only text", () => {
    expect(readPartText(undefined, { id: "part_1", text: "   \n\t  " })).toBe("")
  })

  test("trims leading and trailing whitespace", () => {
    expect(readPartText(undefined, { id: "part_1", text: "\n  body  \n" })).toBe("body")
  })
})
