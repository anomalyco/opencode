import { describe, expect, test } from "bun:test"
import { ConfigMarkdown } from "@opencode/core/config/markdown"

const invalidYaml = `---
description: Use when the user needs to crawl pages. Keywords: crawl, scrape
---
body`

// `[Team]` opens a flow sequence and the trailing text leaves the document unparseable, so in
// OpenCode 1 the agent disappeared from the registry without a word.
const bracketedYaml = `---
description: [Team] Does a thing
mode: subagent
---
body`

// An unterminated flow sequence has only a broken reading, so it keeps failing loudly.
const unrecoverableYaml = `---
description: [unclosed
---
body`

describe("ConfigMarkdown.parse", () => {
  test("recovers unquoted-colon frontmatter via the sanitize fallback", () => {
    const parsed = ConfigMarkdown.parse(invalidYaml)
    expect(parsed.data.description).toBe("Use when the user needs to crawl pages. Keywords: crawl, scrape")
    expect(parsed.content.trim()).toBe("body")
  })

  test("recovers an unquoted value that opens with a YAML indicator", () => {
    const parsed = ConfigMarkdown.parse(bracketedYaml)
    expect(parsed.data.description).toBe("[Team] Does a thing")
    expect(parsed.data.mode).toBe("subagent")
    expect(parsed.content.trim()).toBe("body")
  })

  test("keeps a valid flow sequence and numeric scalar untouched", () => {
    // sanitize only runs after the strict parse failed, so a document that parses keeps its types.
    const parsed = ConfigMarkdown.parse(`---\ntags: [a, b]\ntemperature: 0.5\n---\nbody`)
    expect(parsed.data.tags).toEqual(["a", "b"])
    expect(parsed.data.temperature).toBe(0.5)
  })

  test("recovers the same content again after a previous failed parse", () => {
    // gray-matter caches by content before parsing; a poisoned entry used to
    // make every later parse of the same text return silently without data.
    expect(() => ConfigMarkdown.parse(unrecoverableYaml)).toThrow()
    const parsed = ConfigMarkdown.parse(invalidYaml)
    expect(parsed.data.description).toBe("Use when the user needs to crawl pages. Keywords: crawl, scrape")
  })

  test("keeps throwing for the same unparseable content on every call", () => {
    const input = unrecoverableYaml
    expect(() => ConfigMarkdown.parse(input)).toThrow()
    expect(() => ConfigMarkdown.parse(input)).toThrow()
  })

  test("parses plain content without frontmatter", () => {
    const parsed = ConfigMarkdown.parse("just body")
    expect(parsed.content).toBe("just body")
    expect(parsed.data).toEqual({})
  })
})