import { describe, expect, test } from "bun:test"
import * as ConfigMarkdown from "./markdown"

describe("ConfigMarkdown.parse", () => {
  // An unquoted plain scalar beginning with `[` is read as a YAML flow
  // sequence; `[Team] Does a thing` is not valid flow syntax, so the whole
  // frontmatter block used to fail and the document (an agent markdown file)
  // was dropped silently.
  test("keeps a frontmatter value that starts with an unquoted [", () => {
    const content = ["---", "description: [Test] unquoted description", "mode: subagent", "---", "Body"].join("\n")
    const parsed = ConfigMarkdown.parse(content)
    expect(parsed.data.description).toBe("[Test] unquoted description")
    expect(parsed.data.mode).toBe("subagent")
  })

  test("still parses a real flow sequence", () => {
    const content = ["---", "description: ['a', 'b']", "---", "Body"].join("\n")
    const parsed = ConfigMarkdown.parse(content)
    expect(parsed.data.description).toEqual(["a", "b"])
  })

  test("still keeps unquoted colons working", () => {
    const content = ["---", "description: Use when needed. Keywords: a, b", "---", "Body"].join("\n")
    const parsed = ConfigMarkdown.parse(content)
    expect(parsed.data.description).toBe("Use when needed. Keywords: a, b")
  })
})
