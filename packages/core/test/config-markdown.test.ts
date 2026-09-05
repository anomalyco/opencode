import { describe, expect, test } from "bun:test"
import { ConfigMarkdown } from "../src/config/markdown"

describe("ConfigMarkdown.parse", () => {
  test("reparses sanitized frontmatter after a failed strict parse", () => {
    const content = `---
name: repeated
description: Trigger keywords: "e2e", "test"
---
body`

    expect(ConfigMarkdown.parse(content).data).toEqual({
      name: "repeated",
      description: 'Trigger keywords: "e2e", "test"',
    })
    expect(ConfigMarkdown.parse(content).data).toEqual({
      name: "repeated",
      description: 'Trigger keywords: "e2e", "test"',
    })
  })
})
