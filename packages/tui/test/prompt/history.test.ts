import { describe, expect, test } from "bun:test"
import {
  isDuplicateEntry,
  MAX_HISTORY_ENTRIES,
  MAX_HISTORY_SESSIONS,
  parsePromptHistory,
  promptHistoryView,
  retainPromptHistory,
  type PromptHistoryEntry,
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

  test("dedupes the same prompt sent in another session", () => {
    expect(isDuplicateEntry({ ...entry("hello"), sessionID: "ses_a" }, { ...entry("hello"), sessionID: "ses_b" })).toBe(
      true,
    )
  })
})

describe("prompt history scope", () => {
  const tagged = (input: string, sessionID?: string, mode?: PromptInfo["mode"]): PromptHistoryEntry => ({
    ...entry(input),
    ...(mode ? { mode } : {}),
    ...(sessionID ? { sessionID } : {}),
  })
  const history = [tagged("old"), tagged("a1", "ses_a"), tagged("b1", "ses_b"), tagged("ls", "ses_a", "shell")]

  test("global walks every session's prompts", () => {
    expect(promptHistoryView(history, "global", "ses_a").map((item) => item.input)).toEqual(["old", "a1", "b1", "ls"])
  })

  test("session walks only the prompts sent in that session, shell mode included", () => {
    expect(promptHistoryView(history, "session", "ses_a")).toEqual([tagged("a1", "ses_a"), tagged("ls", "ses_a", "shell")])
    expect(promptHistoryView(history, "session", "ses_b").map((item) => item.input)).toEqual(["b1"])
    expect(promptHistoryView(history, "session", "ses_new")).toEqual([])
  })

  test("session on the home screen walks every session's prompts", () => {
    expect(promptHistoryView(history, "session", undefined).map((item) => item.input)).toEqual(["old", "a1", "b1", "ls"])
  })

  test("global keeps the newest entries of all sessions", () => {
    const entries = Array.from({ length: MAX_HISTORY_ENTRIES + 5 }, (_, index) => tagged(String(index), "ses_a"))
    expect(retainPromptHistory([tagged("quiet", "ses_b"), ...entries], "global")).toEqual(entries.slice(5))
  })

  test("session keeps each session's newest entries, so a busy one cannot push a quiet one out", () => {
    const busy = Array.from({ length: MAX_HISTORY_ENTRIES + 5 }, (_, index) => tagged(String(index), "ses_a"))
    const result = retainPromptHistory([tagged("quiet", "ses_b"), ...busy], "session")
    expect(result[0]).toEqual(tagged("quiet", "ses_b"))
    expect(result.slice(1)).toEqual(busy.slice(5))
  })

  test("session keeps only the most recently used sessions", () => {
    const entries = Array.from({ length: MAX_HISTORY_SESSIONS + 2 }, (_, index) => tagged("p", `ses_${index}`))
    const result = retainPromptHistory(entries, "session")
    expect(result).toEqual(entries.slice(2))
  })

  test("parses with the scope's retention", () => {
    const text = Array.from({ length: MAX_HISTORY_ENTRIES + 1 }, (_, index) =>
      JSON.stringify(tagged(String(index), `ses_${index % 2}`)),
    ).join("\n")
    expect(parsePromptHistory(text, "global")).toHaveLength(MAX_HISTORY_ENTRIES)
    expect(parsePromptHistory(text, "session")).toHaveLength(MAX_HISTORY_ENTRIES + 1)
  })
})
