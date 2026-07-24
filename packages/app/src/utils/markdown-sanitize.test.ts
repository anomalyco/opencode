import { describe, expect, test } from "bun:test"
import { sanitizeMarkdown } from "@opencode-ai/session-ui/markdown-cache"

describe("markdown link sanitization", () => {
  test("keeps supported OpenCode deep links", () => {
    const html = sanitizeMarkdown('<a href="opencode://open-session/ses_123">Open session</a>')
    expect(html).toContain('href="opencode://open-session/ses_123"')
  })

  test("keeps other OpenCode links and removes unsafe protocols", () => {
    expect(sanitizeMarkdown('<a href="opencode://unknown?directory=%2Ftmp%2Ftest">Unknown</a>')).toContain(
      'href="opencode://unknown?directory=%2Ftmp%2Ftest"',
    )
    expect(sanitizeMarkdown('<a href="javascript:alert(1)">Script</a>')).toBe("<a>Script</a>")
  })
})
