import { describe, expect, test } from "bun:test"
import { isDuplicateEntry, MAX_HISTORY_ENTRIES, parsePromptHistory, type PromptInfo } from "../../src/prompt/history"

const entry = (text: string, files: PromptInfo["files"] = []): PromptInfo => ({
  text,
  files,
  agents: [],
  pasted: [],
})

describe("prompt history", () => {
  test("recovers valid JSONL entries around corruption", () => {
    expect(parsePromptHistory(`${JSON.stringify(entry("one"))}\nnot-json\n${JSON.stringify(entry("two"))}\n`)).toEqual([
      entry("one"),
      entry("two"),
    ])
  })

  test("ignores the legacy parts shape", () => {
    expect(parsePromptHistory(JSON.stringify({ input: "old", parts: [] }))).toEqual([])
  })

  test("retains only the newest entries", () => {
    const input = Array.from({ length: MAX_HISTORY_ENTRIES + 5 }, (_, index) =>
      JSON.stringify(entry(String(index))),
    ).join("\n")
    const result = parsePromptHistory(input)
    expect(result).toHaveLength(MAX_HISTORY_ENTRIES)
    expect(result[0]?.text).toBe("5")
  })

  test("dedupes only identical consecutive entries", () => {
    expect(isDuplicateEntry(undefined, entry("hello"))).toBe(false)
    expect(isDuplicateEntry(entry("hello"), entry("hello"))).toBe(true)
    expect(isDuplicateEntry(entry("foo"), entry("bar"))).toBe(false)
    expect(isDuplicateEntry({ ...entry("ls"), mode: "normal" }, { ...entry("ls"), mode: "shell" })).toBe(false)
  })

  test("does not dedupe entries with different attachments", () => {
    const a = entry("describe this", [{ name: "a.png", uri: "data:image/png;base64,AAA" }])
    const b = entry("describe this", [{ name: "b.png", uri: "data:image/png;base64,BBB" }])
    expect(isDuplicateEntry(a, b)).toBe(false)
  })

})
