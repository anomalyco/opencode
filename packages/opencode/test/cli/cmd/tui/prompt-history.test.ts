import { describe, expect, test } from "bun:test"
import { isDuplicateEntry, type PromptInfo } from "../../../../src/cli/cmd/tui/component/prompt/history"

const entry = (input: string, parts: PromptInfo["parts"] = []): PromptInfo => ({ input, parts })

describe("prompt history dedupe", () => {
  test("returns false when there is no previous entry", () => {
    expect(isDuplicateEntry(undefined, entry("hello"))).toBe(false)
  })

  test("dedupes identical consecutive entries", () => {
    const a = entry("hello world this is over twenty chars")
    const b = entry("hello world this is over twenty chars")
    expect(isDuplicateEntry(a, b)).toBe(true)
  })

  test("does not dedupe when input text differs", () => {
    expect(isDuplicateEntry(entry("foo"), entry("bar"))).toBe(false)
  })

  test("does not dedupe when parts differ", () => {
    const a = entry("describe this", [
      {
        type: "file",
        mime: "image/png",
        filename: "a.png",
        url: "data:image/png;base64,AAA",
      },
    ])
    const b = entry("describe this", [
      {
        type: "file",
        mime: "image/png",
        filename: "b.png",
        url: "data:image/png;base64,BBB",
      },
    ])
    expect(isDuplicateEntry(a, b)).toBe(false)
  })

  test("does not dedupe when mode differs", () => {
    expect(isDuplicateEntry({ ...entry("ls"), mode: "normal" }, { ...entry("ls"), mode: "shell" })).toBe(false)
  })
})
