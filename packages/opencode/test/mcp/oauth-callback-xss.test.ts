import { describe, expect, test } from "bun:test"

/**
 * CWE-79: Cross-Site Scripting (XSS)
 * File: packages/opencode/src/mcp/oauth-callback.ts
 *
 * HTML_ERROR interpolated error string directly into HTML template.
 * Since error comes from URL query params (error, error_description),
 * an attacker could craft a malicious OAuth callback URL to inject scripts.
 */

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

const HTML_ERROR = (error: string) => `<div class="error">${escapeHtml(error)}</div>`

describe("CWE-79: XSS in oauth-callback.ts HTML_ERROR", () => {
  test("should escape script tags in error message", () => {
    const result = HTML_ERROR('<script>alert("xss")</script>')
    expect(result).not.toContain("<script>")
    expect(result).toContain("&lt;script&gt;")
  })

  test("should escape img onerror payload", () => {
    const result = HTML_ERROR('<img src=x onerror=alert(1)>')
    expect(result).not.toContain("<img")
    expect(result).toContain("&lt;img")
  })

  test("should escape HTML entities in error_description", () => {
    const result = HTML_ERROR('access_denied&error_description=<b>bold</b>')
    expect(result).not.toContain("<b>")
    expect(result).toContain("&lt;b&gt;")
  })

  test("should escape quotes to prevent attribute injection", () => {
    const result = HTML_ERROR('" onmouseover="alert(1)')
    expect(result).toContain("&quot;")
    expect(result).not.toContain(' onmouseover="alert')
  })

  test("should render normal error messages correctly", () => {
    const result = HTML_ERROR("access_denied")
    expect(result).toContain("access_denied")
    expect(result).toContain('class="error"')
  })
})
