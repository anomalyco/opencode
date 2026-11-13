import { describe, expect, test } from "bun:test"
import { linkSegments } from "./link-segments.js"

describe("linkSegments", () => {
  test("marks URLs in shell output", () => {
    expect(linkSegments("Created https://github.com/anomalyco/opencode/pull/57302\n")).toEqual([
      { text: "Created " },
      {
        text: "https://github.com/anomalyco/opencode/pull/57302",
        href: "https://github.com/anomalyco/opencode/pull/57302",
      },
      { text: "\n" },
    ])
  })

  test("leaves trailing punctuation outside the link", () => {
    expect(linkSegments("(see https://example.com/a).")).toEqual([
      { text: "(see " },
      { text: "https://example.com/a", href: "https://example.com/a" },
      { text: ")." },
    ])
  })

  test("preserves prompt text verbatim and only marks bare URLs", () => {
    const input = "Read [the docs](https://example.com/docs) and https://example.com/bare, thanks"
    const segments = linkSegments(input)
    expect(segments).toEqual([
      { text: "Read [the docs](" },
      { text: "https://example.com/docs", href: "https://example.com/docs" },
      { text: ") and " },
      { text: "https://example.com/bare", href: "https://example.com/bare" },
      { text: ", thanks" },
    ])
    expect(segments.map((s) => s.text).join("")).toBe(input)
  })

  test("returns text without URLs as one run", () => {
    expect(linkSegments("no links here")).toEqual([{ text: "no links here" }])
    expect(linkSegments("")).toEqual([])
  })

  test("runs in linear time on long text without URLs", () => {
    const text = "a".repeat(1_000_000)
    const start = performance.now()
    const segments = linkSegments(text)
    const elapsed = performance.now() - start
    expect(segments).toEqual([{ text }])
    expect(elapsed).toBeLessThan(100)
  })
})
