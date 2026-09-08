import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { normalizeBasePath } from "../../src/cli/network"
import { cspForHtml, injectBasePath } from "../../src/server/shared/ui"

describe("normalizeBasePath", () => {
  test("returns empty for undefined", () => {
    expect(normalizeBasePath(undefined)).toBe("")
  })

  test("returns empty for empty string", () => {
    expect(normalizeBasePath("")).toBe("")
  })

  test("returns empty for whitespace", () => {
    expect(normalizeBasePath("   ")).toBe("")
  })

  test("returns empty for single slash", () => {
    expect(normalizeBasePath("/")).toBe("")
  })

  test("ensures leading slash", () => {
    expect(normalizeBasePath("opencode")).toBe("/opencode")
  })

  test("keeps existing leading slash", () => {
    expect(normalizeBasePath("/opencode")).toBe("/opencode")
  })

  test("strips trailing slashes", () => {
    expect(normalizeBasePath("/opencode/")).toBe("/opencode")
    expect(normalizeBasePath("/opencode///")).toBe("/opencode")
  })

  test("handles nested paths", () => {
    expect(normalizeBasePath("/apps/opencode")).toBe("/apps/opencode")
  })

  test("trims whitespace around path", () => {
    expect(normalizeBasePath("  /opencode  ")).toBe("/opencode")
  })
})

describe("injectBasePath", () => {
  const minimalHtml = `<html><head><title>Test</title></head><body></body></html>`

  test("returns html unchanged when basePath is empty", () => {
    expect(injectBasePath(minimalHtml, "")).toBe(minimalHtml)
  })

  test("injects global script into head", () => {
    const result = injectBasePath(minimalHtml, "/opencode")
    expect(result).toContain(`<script>window.__OPENCODE_BASE_PATH__="/opencode"</script>`)
  })

  test("rewrites href attributes", () => {
    const html = `<html><head><link rel="stylesheet" href="/assets/style.css"></head><body></body></html>`
    const result = injectBasePath(html, "/opencode")
    expect(result).toContain(`href="/opencode/assets/style.css"`)
  })

  test("rewrites src attributes", () => {
    const html = `<html><head><script src="/assets/app.js"></script></head><body></body></html>`
    const result = injectBasePath(html, "/opencode")
    expect(result).toContain(`src="/opencode/assets/app.js"`)
  })

  test("does not rewrite protocol-relative URLs", () => {
    const html = `<html><head><link href="//cdn.example.com/style.css"></head><body></body></html>`
    const result = injectBasePath(html, "/opencode")
    expect(result).toContain(`href="//cdn.example.com/style.css"`)
  })

  test("does not rewrite content attributes", () => {
    const html = `<html><head><meta name="viewport" content="/not-a-url"></head><body></body></html>`
    const result = injectBasePath(html, "/opencode")
    expect(result).toContain(`content="/not-a-url"`)
  })

  test("escapes basePath to prevent XSS via script tag breakout", () => {
    const result = injectBasePath(minimalHtml, '/test"</script><script>alert(1)</script>')
    expect(result).not.toContain("alert(1)</script>")
    expect(result).toContain("\\u003c")
  })
})

describe("cspForHtml with injected base path", () => {
  test("includes hash for injected base path script", () => {
    const html = `<html><head><title>Test</title></head><body></body></html>`
    const injected = injectBasePath(html, "/opencode")
    const csp = cspForHtml(injected)

    const scriptContent = `window.__OPENCODE_BASE_PATH__="/opencode"`
    const expectedHash = createHash("sha256").update(scriptContent).digest("base64")
    expect(csp).toContain(`'sha256-${expectedHash}'`)
  })

  test("includes hashes for both injected and existing inline scripts", () => {
    const existingScript = 'document.documentElement.dataset.theme = "dark"'
    const html = `<html><head><script id="oc-theme-preload-script">${existingScript}</script></head><body></body></html>`
    const injected = injectBasePath(html, "/opencode")
    const csp = cspForHtml(injected)

    const existingHash = createHash("sha256").update(existingScript).digest("base64")
    const injectedScript = `window.__OPENCODE_BASE_PATH__="/opencode"`
    const injectedHash = createHash("sha256").update(injectedScript).digest("base64")

    expect(csp).toContain(`'sha256-${existingHash}'`)
    expect(csp).toContain(`'sha256-${injectedHash}'`)
  })
})
