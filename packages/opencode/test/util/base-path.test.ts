import { describe, expect, test } from "bun:test"
import {
  normalizeBasePath,
  joinPath,
  generateBasePathScript,
  rewriteHtmlForBasePath,
  rewriteJsForBasePath,
  rewriteCssForBasePath,
} from "../../src/util/base-path"

describe("util.base-path", () => {
  describe("normalizeBasePath", () => {
    test("returns empty string for root", () => {
      expect(normalizeBasePath("/")).toBe("")
      expect(normalizeBasePath(undefined)).toBe("")
    })

    test("returns empty string for empty string", () => {
      expect(normalizeBasePath("")).toBe("")
    })

    test("normalizes paths with leading slash", () => {
      expect(normalizeBasePath("/prefix")).toBe("/prefix")
      expect(normalizeBasePath("/notebook/namespace/name")).toBe("/notebook/namespace/name")
    })

    test("removes trailing slash", () => {
      expect(normalizeBasePath("/prefix/")).toBe("/prefix")
      expect(normalizeBasePath("/notebook/namespace/name/")).toBe("/notebook/namespace/name")
    })

    test("adds leading slash if missing", () => {
      expect(normalizeBasePath("prefix")).toBe("/prefix")
      expect(normalizeBasePath("notebook/namespace/name")).toBe("/notebook/namespace/name")
    })

    test("handles path without leading slash and with trailing slash", () => {
      expect(normalizeBasePath("prefix/")).toBe("/prefix")
      expect(normalizeBasePath("notebook/namespace/name/")).toBe("/notebook/namespace/name")
    })

    test("handles multiple trailing slashes", () => {
      expect(normalizeBasePath("/prefix///")).toBe("/prefix")
    })
  })

  describe("joinPath", () => {
    test("joins base path with segments", () => {
      expect(joinPath("/prefix", "api", "v1")).toBe("/prefix/api/v1")
      expect(joinPath("/prefix", "/api", "/v1")).toBe("/prefix/api/v1")
    })

    test("handles empty base path", () => {
      expect(joinPath("/", "api", "v1")).toBe("/api/v1")
      expect(joinPath("", "api", "v1")).toBe("/api/v1")
    })

    test("normalizes multiple slashes", () => {
      expect(joinPath("/prefix", "//api//", "//v1")).toBe("/prefix/api/v1")
    })

    test("handles segments with leading slashes", () => {
      expect(joinPath("/prefix", "/session")).toBe("/prefix/session")
    })

    test("handles trailing slash on base path", () => {
      expect(joinPath("/prefix/", "api")).toBe("/prefix/api")
    })
  })

  describe("generateBasePathScript", () => {
    test("generates script with basePath variable", () => {
      const script = generateBasePathScript("/myapp")
      expect(script).toContain('window.__OPENCODE_BASE_PATH__="/myapp"')
      expect(script).toContain("<script>")
      expect(script).toContain("</script>")
    })

    test("includes history.pushState wrapper", () => {
      const script = generateBasePathScript("/myapp")
      expect(script).toContain("history.pushState")
      expect(script).toContain("origPushState")
    })

    test("includes history.replaceState wrapper", () => {
      const script = generateBasePathScript("/myapp")
      expect(script).toContain("history.replaceState")
      expect(script).toContain("origReplaceState")
    })
  })

  describe("rewriteHtmlForBasePath", () => {
    test("returns unchanged HTML when basePath is empty", () => {
      const html = '<a href="/assets/main.js">Link</a>'
      expect(rewriteHtmlForBasePath(html, "")).toBe(html)
    })

    test("rewrites href attributes with absolute paths", () => {
      const html = '<a href="/page">Link</a>'
      const result = rewriteHtmlForBasePath(html, "/myapp")
      expect(result).toContain('href="/myapp/page"')
    })

    test("rewrites src attributes with absolute paths", () => {
      const html = '<script src="/assets/main.js"></script>'
      const result = rewriteHtmlForBasePath(html, "/myapp")
      expect(result).toContain('src="/myapp/assets/main.js"')
    })

    test("rewrites content attributes with absolute paths", () => {
      const html = '<meta content="/image.png">'
      const result = rewriteHtmlForBasePath(html, "/myapp")
      expect(result).toContain('content="/myapp/image.png"')
    })

    test("does NOT rewrite protocol-relative URLs", () => {
      const html = '<a href="//cdn.example.com/file.js">Link</a>'
      const result = rewriteHtmlForBasePath(html, "/myapp")
      expect(result).toContain('href="//cdn.example.com/file.js"')
    })

    test("does NOT rewrite relative paths without leading slash", () => {
      const html = '<a href="page.html">Link</a>'
      const result = rewriteHtmlForBasePath(html, "/myapp")
      expect(result).toContain('href="page.html"')
    })

    test("injects basePath script before </head>", () => {
      const html = "<html><head><title>Test</title></head><body></body></html>"
      const result = rewriteHtmlForBasePath(html, "/myapp")
      expect(result).toContain('window.__OPENCODE_BASE_PATH__="/myapp"')
      expect(result).toContain("</script></head>")
    })

    test("handles multiple attributes in same HTML", () => {
      const html = '<link href="/style.css"><script src="/app.js"></script>'
      const result = rewriteHtmlForBasePath(html, "/prefix")
      expect(result).toContain('href="/prefix/style.css"')
      expect(result).toContain('src="/prefix/app.js"')
    })
  })

  describe("rewriteJsForBasePath", () => {
    test("returns unchanged JS when basePath is empty", () => {
      const js = "const url = window.location.origin)"
      expect(rewriteJsForBasePath(js, "")).toBe(js)
    })

    test("patches window.location.origin with closing paren", () => {
      const js = "const url = :window.location.origin)"
      const result = rewriteJsForBasePath(js, "/myapp")
      expect(result).toContain(':window.location.origin+(window.__OPENCODE_BASE_PATH__||""))')
    })

    test("patches window.location.origin with semicolon (ternary ending)", () => {
      const js = 'location.hostname.includes("opencode.ai")?"http://localhost:4096":window.location.origin;return'
      const result = rewriteJsForBasePath(js, "/myapp")
      expect(result).toContain(':window.location.origin+(window.__OPENCODE_BASE_PATH__||"");return')
    })

    test("patches Vite base path function", () => {
      const js = 'function(t){return"/"+t}'
      const result = rewriteJsForBasePath(js, "/myapp")
      expect(result).toBe('function(t){return"/myapp/"+t}')
    })

    test("handles multiple Vite function occurrences", () => {
      const js = 'function(t){return"/"+t};function(t){return"/"+t}'
      const result = rewriteJsForBasePath(js, "/app")
      expect(result).toBe('function(t){return"/app/"+t};function(t){return"/app/"+t}')
    })

    test("does NOT modify unrelated code", () => {
      const js = 'const x = 1; function foo() { return "hello"; }'
      const result = rewriteJsForBasePath(js, "/myapp")
      expect(result).toBe(js)
    })
  })

  describe("rewriteCssForBasePath", () => {
    test("returns unchanged CSS when basePath is empty", () => {
      const css = "background: url(/assets/bg.png);"
      expect(rewriteCssForBasePath(css, "")).toBe(css)
    })

    test("rewrites url() with absolute paths", () => {
      const css = "background: url(/assets/image.png);"
      const result = rewriteCssForBasePath(css, "/myapp")
      expect(result).toBe("background: url(/myapp/assets/image.png);")
    })

    test("rewrites multiple url() occurrences", () => {
      const css = "@font-face { src: url(/fonts/a.woff); } .bg { background: url(/img/bg.png); }"
      const result = rewriteCssForBasePath(css, "/prefix")
      expect(result).toContain("url(/prefix/fonts/a.woff)")
      expect(result).toContain("url(/prefix/img/bg.png)")
    })

    test("does NOT rewrite protocol-relative URLs", () => {
      const css = "background: url(//cdn.example.com/image.png);"
      const result = rewriteCssForBasePath(css, "/myapp")
      expect(result).toBe("background: url(//cdn.example.com/image.png);")
    })

    test("does NOT rewrite relative paths", () => {
      const css = "background: url(assets/image.png);"
      const result = rewriteCssForBasePath(css, "/myapp")
      expect(result).toBe("background: url(assets/image.png);")
    })

    test("does NOT rewrite data URIs", () => {
      const css = "background: url(data:image/png;base64,abc123);"
      const result = rewriteCssForBasePath(css, "/myapp")
      expect(result).toBe("background: url(data:image/png;base64,abc123);")
    })
  })
})
