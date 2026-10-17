import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import {
  appendPrompt,
  isDuplicateEntry,
  MAX_HISTORY_ENTRIES,
  parsePromptHistory,
  restorePromptHistory,
  type PromptInfo,
} from "../../src/prompt/history"

const entry = (text: string, files: PromptInfo["files"] = []): PromptInfo => ({
  text,
  files,
  agents: [],
  pasted: [],
})

describe("prompt history", () => {
  test("restores only marked workspace files without changing stored history", () => {
    const old = path.resolve("history-a")
    const next = path.resolve("history-b")
    const uri = pathToFileURL(path.join(old, "test")).href + "?start=2&end=3"
    const value = entry("@test @reference", [
      { uri, workspaceRelative: "test", mention: { start: 0, end: 5, text: "@test" } },
      { uri, name: "reference", mention: { start: 6, end: 16, text: "@reference" } },
      { uri, name: "absolute" },
      { uri: "data:image/png;base64,AAA", name: "clipboard" },
    ])
    const stored = structuredClone(value)
    const restored = restorePromptHistory(value, next)
    expect(restored.files?.[0]?.uri).toBe(pathToFileURL(path.join(next, "test")).href + "?start=2&end=3")
    expect(restored.files?.slice(1)).toEqual(stored.files?.slice(1))
    const mention = restored.files?.[0]?.mention
    if (mention) mention.start = 99
    expect(value).toEqual(stored)
    expect(restorePromptHistory(value, old).files?.[0]?.uri).toBe(uri)
    expect(restorePromptHistory(entry("legacy", [{ uri }]), next).files?.[0]?.uri).toBe(uri)
  })

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

  test("preserves duplicate attachment mentions for prompt restoration", () => {
    const value = entry("[Image 1] [Image 1]", [
      {
        name: "clipboard",
        uri: "data:image/png;base64,AAA",
        mention: { start: 0, end: 9, text: "[Image 1]" },
      },
      {
        name: "clipboard",
        uri: "data:image/png;base64,AAA",
        mention: { start: 10, end: 19, text: "[Image 1]" },
      },
    ])

    expect(parsePromptHistory(JSON.stringify(value))).toEqual([value])
  })

  test("appends a prompt on a new line and shifts its ranges by display width", () => {
    const output = appendPrompt(
      { ...entry("日本"), pasted: [{ text: "long", source: { start: 0, end: 4, text: "日本" } }] },
      {
        ...entry("@a.ts [Pasted]", [{ uri: "file:///a.ts", mention: { start: 0, end: 5, text: "@a.ts" } }]),
        agents: [{ name: "build" }],
        pasted: [{ text: "more", source: { start: 6, end: 14, text: "[Pasted]" } }],
      },
    )

    expect(output).toEqual({
      text: "日本\n\n@a.ts [Pasted]",
      files: [{ uri: "file:///a.ts", mention: { start: 6, end: 11, text: "@a.ts" } }],
      agents: [{ name: "build", mention: undefined }],
      skills: [],
      pasted: [
        { text: "long", source: { start: 0, end: 4, text: "日本" } },
        { text: "more", source: { start: 12, end: 20, text: "[Pasted]" } },
      ],
    })
    expect(appendPrompt(entry(""), entry("next")).text).toBe("next")
  })
})
