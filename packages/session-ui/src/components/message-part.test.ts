import { describe, expect, test } from "bun:test"
import { readPartText } from "./message-part-text"
import { formatTaskSubtitle } from "./message-part-task"

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

describe("formatTaskSubtitle", () => {
  test("renders async vocabulary from retained background metadata", () => {
    expect(formatTaskSubtitle("Inspect renderer", true)).toBe("Inspect renderer (async)")
  })

  test("leaves synchronous and absent subtitles unchanged", () => {
    expect(formatTaskSubtitle("Inspect renderer", false)).toBe("Inspect renderer")
    expect(formatTaskSubtitle(undefined, true)).toBeUndefined()
    expect(formatTaskSubtitle("", true)).toBe("")
  })
})
