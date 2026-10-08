import { describe, expect, test } from "bun:test"
import {
  createPromptHistory,
  isDuplicateEntry,
  MAX_HISTORY_ENTRIES,
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

  test("preserves entries appended while startup history is loading", async () => {
    let disk = JSON.stringify(entry("existing")) + "\n"
    let resolveRead: (() => void) | undefined
    const history = createPromptHistory({
      read() {
        const snapshot = disk
        return new Promise((resolve) => {
          resolveRead = () => resolve(snapshot)
        })
      },
      async write(content) {
        disk = content
      },
      async append(content) {
        disk += content
      },
    })

    const loading = history.load()
    history.append(entry("submitted during startup"))
    resolveRead?.()
    await loading

    expect(parsePromptHistory(disk)).toEqual([entry("existing"), entry("submitted during startup")])
    expect(history.move(-1, "")).toEqual(entry("submitted during startup"))
    expect(history.move(-1, "submitted during startup")).toEqual(entry("existing"))
  })
})
