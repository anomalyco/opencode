import { describe, expect, test } from "bun:test"
import { DEFAULT_CSP, csp, cspForHtml } from "../../src/server/shared/ui"

describe("embedded UI CSP", () => {
  test("allows same-origin blob frames and objects", () => {
    expect(DEFAULT_CSP).toContain("frame-src 'self' blob:")
    expect(DEFAULT_CSP).toContain("object-src 'self' blob:")
  })

  test("keeps the blob allowances when a theme preload hash is added", () => {
    const policy = csp("abc123")
    expect(policy).toContain("frame-src 'self' blob:")
    expect(policy).toContain("object-src 'self' blob:")
    expect(policy).toContain("'sha256-abc123'")
  })

  test("cspForHtml keeps the blob allowances for documents with a theme preload script", () => {
    const body = '<script id="oc-theme-preload-script">document.title = "test"</script>'
    const policy = cspForHtml(body)
    expect(policy).toContain("frame-src 'self' blob:")
    expect(policy).toContain("object-src 'self' blob:")
    expect(policy).toContain("'sha256-")
  })
})
