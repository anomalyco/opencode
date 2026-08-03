import { describe, expect, test } from "bun:test"
import {
  isDuplicateEntry,
  MAX_HISTORY_ENTRIES,
  orderHistoryForSession,
  parsePromptHistory,
  type PromptInfo,
} from "../../src/prompt/history"

const entry = (input: string, parts: PromptInfo["parts"] = []): PromptInfo => ({ input, parts })

describe("prompt history", () => {
  test("recovers valid JSONL entries around corruption", () => {
    expect(parsePromptHistory(`${JSON.stringify(entry("one"))}\nnot-json\n${JSON.stringify(entry("two"))}\n`)).toEqual([
      entry("one"),
      entry("two"),
    ])
  })

  test("retains only the newest entries", () => {
    const input = Array.from({ length: MAX_HISTORY_ENTRIES + 5 }, (_, index) =>
      JSON.stringify(entry(String(index))),
    ).join("\n")
    const result = parsePromptHistory(input)
    expect(result).toHaveLength(MAX_HISTORY_ENTRIES)
    expect(result[0]?.input).toBe("5")
  })

  test("dedupes only identical consecutive entries", () => {
    expect(isDuplicateEntry(undefined, entry("hello"))).toBe(false)
    expect(isDuplicateEntry(entry("hello"), entry("hello"))).toBe(true)
    expect(isDuplicateEntry(entry("foo"), entry("bar"))).toBe(false)
    expect(isDuplicateEntry({ ...entry("ls"), mode: "normal" }, { ...entry("ls"), mode: "shell" })).toBe(false)
  })

  test("does not dedupe entries with different parts", () => {
    const a = entry("describe this", [
      { type: "file", mime: "image/png", filename: "a.png", url: "data:image/png;base64,AAA" },
    ])
    const b = entry("describe this", [
      { type: "file", mime: "image/png", filename: "b.png", url: "data:image/png;base64,BBB" },
    ])
    expect(isDuplicateEntry(a, b)).toBe(false)
  })

  test("parses entries without session metadata", () => {
    const legacy = entry("legacy")
    expect(parsePromptHistory(JSON.stringify(legacy))).toEqual([legacy])
    const tagged = { ...entry("tagged"), sessionID: "ses_1", origin: "stash" as const }
    expect(parsePromptHistory(`${JSON.stringify(legacy)}\n${JSON.stringify(tagged)}`)).toEqual([legacy, tagged])
  })
})

describe("orderHistoryForSession", () => {
  const a: PromptInfo = { ...entry("a oldest"), sessionID: "ses_1", origin: "submit" }
  const b: PromptInfo = { ...entry("b other"), sessionID: "ses_2", origin: "submit" }
  const c: PromptInfo = { ...entry("c newest own"), sessionID: "ses_1", origin: "stash" }
  const d: PromptInfo = entry("d untagged")
  const history = [a, b, c, d]

  test("puts the given session first, newest first within each group", () => {
    expect(orderHistoryForSession(history, "ses_1")).toEqual([c, a, d, b])
  })

  test("untagged entries never match the session", () => {
    expect(orderHistoryForSession(history, "ses_2")).toEqual([b, d, c, a])
  })

  test("without a session keeps global newest-first order", () => {
    expect(orderHistoryForSession(history)).toEqual([d, c, b, a])
    expect(orderHistoryForSession(history, undefined)).toEqual([d, c, b, a])
  })

  test("unknown session falls back to global order", () => {
    expect(orderHistoryForSession(history, "ses_unknown")).toEqual([d, c, b, a])
  })

  test("does not mutate the input", () => {
    orderHistoryForSession(history, "ses_1")
    expect(history).toEqual([a, b, c, d])
  })
})
