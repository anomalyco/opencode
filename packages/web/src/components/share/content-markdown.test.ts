import { describe, expect, test } from "bun:test"

/**
 * CWE-79: Cross-Site Scripting (XSS)
 * File: packages/web/src/components/share/content-markdown.tsx
 *
 * The link renderer interpolated href/title directly into HTML without escaping.
 * Combined with innerHTML rendering, this allows XSS via crafted markdown links.
 */

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

const SAFE_URL_PATTERN = /^(?:https?|mailto|tel):/i

function renderLink(href: string, title: string | null, text: string): string {
  if (!SAFE_URL_PATTERN.test(href)) {
    return `<span>${text}</span>`
  }
  const safeHref = escapeHtml(href)
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ""
  return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
}

describe("CWE-79: XSS in content-markdown.tsx link renderer", () => {
  describe("escapeHtml", () => {
    test("should escape all HTML special characters", () => {
      expect(escapeHtml('<script>"alert(1)"&\'test\'')).toBe("&lt;script&gt;&quot;alert(1)&quot;&amp;&#39;test&#39;")
    })
  })

  describe("URL protocol whitelist", () => {
    test("should block javascript: URLs", () => {
      const result = renderLink("javascript:alert(1)", null, "click")
      expect(result).toBe("<span>click</span>")
      expect(result).not.toContain("href")
    })

    test("should block data: URLs", () => {
      const result = renderLink("data:text/html,<script>alert(1)</script>", null, "click")
      expect(result).toBe("<span>click</span>")
    })

    test("should allow https: URLs", () => {
      const result = renderLink("https://example.com", null, "click")
      expect(result).toContain('href="https://example.com"')
    })

    test("should allow mailto: URLs", () => {
      const result = renderLink("mailto:user@example.com", null, "email")
      expect(result).toContain('href="mailto:user@example.com"')
    })
  })

  describe("attribute escaping", () => {
    test("should escape quotes in href to prevent attribute breakout", () => {
      const result = renderLink('https://example.com" onmouseover="alert(1)', null, "click")
      expect(result).toContain("&quot;")
      // The quotes are escaped, so the browser won't parse onmouseover as an attribute
      expect(result).not.toContain(' onmouseover="alert')
    })

    test("should escape quotes in title", () => {
      const result = renderLink("https://example.com", '" onmouseover="alert(1)', "click")
      expect(result).toContain("&quot;")
      expect(result).not.toContain(' onmouseover="alert')
    })

    test("should escape ampersands in href", () => {
      const result = renderLink("https://example.com?a=1&b=2", null, "click")
      expect(result).toContain("href=\"https://example.com?a=1&amp;b=2\"")
    })
  })

  describe("normal links", () => {
    test("should render correctly with all attributes", () => {
      const result = renderLink("https://opencode.ai", "Official", "OpenCode")
      expect(result).toContain('href="https://opencode.ai"')
      expect(result).toContain('title="Official"')
      expect(result).toContain('target="_blank"')
      expect(result).toContain('rel="noopener noreferrer"')
      expect(result).toContain("OpenCode</a>")
    })
  })
})
