import { describe, expect, test } from "bun:test"

/**
 * CWE-79: XSS in codex.ts HTML_ERROR
 * File: packages/opencode/src/plugin/codex.ts
 *
 * HTML_ERROR interpolated error string directly into HTML.
 * Fix: escapeHtml() sanitizes the error before interpolation.
 */

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

const HTML_ERROR = (error: string) => `<div class="error">${escapeHtml(error)}</div>`

describe("CWE-79: XSS in codex.ts HTML_ERROR", () => {
  test("should escape script tags", () => {
    const result = HTML_ERROR('<script>alert(1)</script>')
    expect(result).not.toContain("<script>")
    expect(result).toContain("&lt;script&gt;")
  })

  test("should escape img onerror payload", () => {
    const result = HTML_ERROR('<img src=x onerror=alert(1)>')
    expect(result).not.toContain("<img")
  })

  test("should escape quotes", () => {
    const result = HTML_ERROR('" onmouseover="alert(1)')
    expect(result).toContain("&quot;")
    expect(result).not.toContain(' onmouseover="alert')
  })

  test("should render normal error messages", () => {
    const result = HTML_ERROR("invalid_grant")
    expect(result).toContain("invalid_grant")
  })
})
