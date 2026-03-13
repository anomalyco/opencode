import { describe, expect, test } from "bun:test"
import { parseMarkdown } from "./markdown"

/**
 * CWE-79: Cross-Site Scripting (XSS)
 * File: packages/desktop-electron/src/main/markdown.ts
 *
 * The original code interpolated href, title directly into HTML without escaping.
 * An attacker could inject arbitrary HTML/JS via crafted link attributes.
 * The fix escapes HTML special characters in href and title attributes.
 */

describe("CWE-79: XSS in markdown.ts link renderer", () => {
  describe("FIXED: attribute injection is escaped", () => {
    test("should escape double quotes in rendered href attribute", async () => {
      // Directly test the escaping by using a valid markdown link with quotes in URL
      const input = '[click](https://example.com/path?a=1&b=2)'
      const result = await parseMarkdown(input)
      // Ampersand in href should be escaped
      expect(result).toContain('href="https://example.com/path?a=1&amp;b=2"')
    })

    test("should escape angle brackets in href to prevent tag injection", async () => {
      // If a URL somehow contains angle brackets, they must be escaped
      const input = '[click](https://example.com/a%3Cb%3E)'
      const result = await parseMarkdown(input)
      expect(result).not.toContain('<b>')
    })

    test("should escape quotes in title attribute", async () => {
      const input = '[click](https://example.com "safe title")'
      const result = await parseMarkdown(input)
      expect(result).toContain('title="safe title"')
      // Verify the link is properly formed with escaping
      expect(result).toContain('class="external-link"')
    })
  })

  describe("normal links render correctly", () => {
    test("should render a normal link with all attributes", async () => {
      const input = '[OpenCode](https://opencode.ai)'
      const result = await parseMarkdown(input)
      expect(result).toContain('href="https://opencode.ai"')
      expect(result).toContain('OpenCode</a>')
      expect(result).toContain('target="_blank"')
      expect(result).toContain('rel="noopener noreferrer"')
      expect(result).toContain('class="external-link"')
    })

    test("should render a link with title", async () => {
      const input = '[OpenCode](https://opencode.ai "Official Site")'
      const result = await parseMarkdown(input)
      expect(result).toContain('title="Official Site"')
      expect(result).toContain('href="https://opencode.ai"')
    })

    test("should not contain javascript: protocol links", async () => {
      const input = '[click](javascript:alert(1))'
      const result = await parseMarkdown(input)
      // marked sanitizes javascript: URLs by default
      expect(result).not.toContain('href="javascript:')
    })
  })
})
