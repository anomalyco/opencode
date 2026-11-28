import { describe, expect, test } from "bun:test"
import { linkSegments } from "./link-segments"

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

  test("keeps closing brackets that belong to the URL", () => {
    expect(linkSegments("see https://en.wikipedia.org/wiki/Mercury_(planet) now")).toEqual([
      { text: "see " },
      {
        text: "https://en.wikipedia.org/wiki/Mercury_(planet)",
        href: "https://en.wikipedia.org/wiki/Mercury_(planet)",
      },
      { text: " now" },
    ])
    expect(linkSegments("(see https://en.wikipedia.org/wiki/Mercury_(planet)).")).toEqual([
      { text: "(see " },
      {
        text: "https://en.wikipedia.org/wiki/Mercury_(planet)",
        href: "https://en.wikipedia.org/wiki/Mercury_(planet)",
      },
      { text: ")." },
    ])
    expect(linkSegments("https://example.com/list[0]")).toEqual([
      { text: "https://example.com/list[0]", href: "https://example.com/list[0]" },
    ])
  })

  test("returns text without URLs as one run", () => {
    expect(linkSegments("no links here")).toEqual([{ text: "no links here" }])
    expect(linkSegments("")).toEqual([])
  })
})
