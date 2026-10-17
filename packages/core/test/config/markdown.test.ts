import { describe, expect, test } from "bun:test"
import { ConfigMarkdown } from "@opencode/core/config/markdown"

const invalidYaml = `---
description: Use when the user needs to crawl pages. Keywords: crawl, scrape
---
body`

// YAML reads a leading `[`/`{` as a flow collection. An unquoted plain scalar
// like `[Team] Does a thing` is not valid flow syntax, so the whole frontmatter
// block used to throw and the document (e.g. an agent) was dropped silently.
const flowScalar = `---
description: [Team] Does a thing
mode: subagent
---
body`

// A value that still cannot be parsed after the fallback (`*ref` is a YAML
// alias that is never defined here), used to keep the throw-on-every-call
// guard meaningful.
const unparseable = `---
description: *ref thing
---
body`

describe("ConfigMarkdown.parse", () => {
  test("recovers unquoted-colon frontmatter via the sanitize fallback", () => {
    const parsed = ConfigMarkdown.parse(invalidYaml)
    expect(parsed.data.description).toBe("Use when the user needs to crawl pages. Keywords: crawl, scrape")
    expect(parsed.content.trim()).toBe("body")
  })

  test("recovers the same content again after a previous failed parse", () => {
    // gray-matter caches by content before parsing; a poisoned entry used to
    // make every later parse of the same text return silently without data.
    expect(() => ConfigMarkdown.parse(unparseable)).toThrow()
    const parsed = ConfigMarkdown.parse(invalidYaml)
    expect(parsed.data.description).toBe("Use when the user needs to crawl pages. Keywords: crawl, scrape")
  })

  test("keeps throwing for the same unparseable content on every call", () => {
    expect(() => ConfigMarkdown.parse(unparseable)).toThrow()
    expect(() => ConfigMarkdown.parse(unparseable)).toThrow()
  })

  test("parses plain content without frontmatter", () => {
    const parsed = ConfigMarkdown.parse("just body")
    expect(parsed.content).toBe("just body")
    expect(parsed.data).toEqual({})
  })

  test("keeps a frontmatter value that starts with an unquoted [", () => {
    const parsed = ConfigMarkdown.parse(flowScalar)
    expect(parsed.data.description).toBe("[Team] Does a thing")
    expect(parsed.data.mode).toBe("subagent")
    expect(parsed.content.trim()).toBe("body")
  })

  test("still parses a real flow sequence", () => {
    const parsed = ConfigMarkdown.parse(`---\ndescription: ['a', 'b']\n---\nbody`)
    expect(parsed.data.description).toEqual(["a", "b"])
  })

  test("still parses a real flow mapping", () => {
    const parsed = ConfigMarkdown.parse(`---\ndescription: [Team] x\ntools: {write: false}\n---\nbody`)
    expect(parsed.data.description).toBe("[Team] x")
    expect(parsed.data.tools).toEqual({ write: false })
  })

  test("still keeps unquoted colons working", () => {
    const parsed = ConfigMarkdown.parse(invalidYaml)
    expect(parsed.data.description).toBe("Use when the user needs to crawl pages. Keywords: crawl, scrape")
  })
})

describe("ConfigMarkdown.parse sanitize context", () => {
  test("keeps multiline blocks when another line needs the colon fallback", () => {
    const content = [
      "---",
      "description: Scope: test",
      "request:",
      "  headers:",
      "    x-a: b",
      "permissions:",
      "  - action: edit",
      '    resource: "*"',
      "    effect: deny",
      "---",
      "body",
    ].join("\n")
    const parsed = ConfigMarkdown.parse(content)
    expect(parsed.data.description).toBe("Scope: test")
    expect(parsed.data.request).toEqual({ headers: { "x-a": "b" } })
    expect(parsed.data.permissions).toEqual([{ action: "edit", resource: "*", effect: "deny" }])
  })

  test("keeps an anchored flow reference when the colon fallback runs", () => {
    const content = [
      "---",
      "defs: &rule {action: edit, effect: deny}",
      "description: Scope: test",
      "permissions: [*rule]",
      "---",
      "body",
    ].join("\n")
    const parsed = ConfigMarkdown.parse(content)
    expect(parsed.data.description).toBe("Scope: test")
    expect(parsed.data.permissions).toEqual([{ action: "edit", effect: "deny" }])
  })
})

describe("ConfigMarkdown.parse sanitize regressions", () => {
  // Values that start with `*`, `&` or `!` are aliases/anchors/tags to YAML, but
  // they are plain text in these descriptions and need the colon fallback.
  test("recovers a description that starts with an asterisk or bang", () => {
    for (const value of ["*Important*: read this", "!Important: read this"]) {
      const parsed = ConfigMarkdown.parse(`---\ndescription: ${value}\n---\nbody`)
      expect(parsed.data.description).toBe(value)
    }
  })

  test("recovers when several lines in the block need the fallback", () => {
    const first = ConfigMarkdown.parse("---\ndescription: [Team] x\nsummary: Scope: test\n---\nbody")
    expect(first.data.description).toBe("[Team] x")
    expect(first.data.summary).toBe("Scope: test")

    const second = ConfigMarkdown.parse("---\ndescription: [A] one\nsummary: [B] two\n---\nbody")
    expect(second.data.description).toBe("[A] one")
    expect(second.data.summary).toBe("[B] two")
  })
})
