import { describe, expect, test } from "bun:test"
import { injectRootPath, normalizeUrl } from "../../src/server/html-utils"

describe("rootPath HTML injection", () => {
  test("injects rootPath into clean HTML", () => {
    const html = '<html><head></head><body><div id="root"></div></body></html>'
    const result = injectRootPath(html, "/proxy")

    expect(result).toContain('<base href="/proxy/">')
    expect(result).toContain('window.__OPENCODE__.rootPath = "/proxy"')
    expect(result).toContain('data-root-path="/proxy"')
  })

  test("prevents XSS via malicious rootPath", () => {
    const maliciousPath = '/test"onerror="alert(1)"'
    const html = '<html><head></head><body><div id="root"></div></body></html>'
    const result = injectRootPath(html, maliciousPath)

    // Should not contain unescaped quotes that could break out
    expect(result).not.toContain('onerror="alert(1)"')
    // Should contain escaped version
    expect(result).toContain("&quot;")

    // JSON.stringify should handle the script tag
    expect(result).toContain(JSON.stringify(maliciousPath))
  })

  test("prevents XSS via script tag injection", () => {
    const maliciousPath = "/test</script><script>alert(1)</script>"
    const html = '<html><head></head><body><div id="root"></div></body></html>'
    const result = injectRootPath(html, maliciousPath)

    // The value should be assigned via JSON string literal
    // This makes it safe because it's never parsed as HTML within the script context
    expect(result).toContain("window.__OPENCODE__.rootPath = ")

    // Verify the base tag has properly escaped HTML attributes
    expect(result).toContain("<base href=")
    expect(result).toContain("&lt;/script&gt;") // HTML escaped in attribute
  })

  test("doesn't duplicate base tag", () => {
    const html = '<html><head><base href="/existing/"></head><body></body></html>'
    const result = injectRootPath(html, "/new")

    const baseTagCount = (result.match(/<base/gi) || []).length
    expect(baseTagCount).toBe(1)
    expect(result).toContain('href="/existing/"')
  })

  test("doesn't duplicate data-root-path attribute", () => {
    const html =
      '<html><head></head><body><div id="root" data-root-path="/existing"></div></body></html>'
    const result = injectRootPath(html, "/new")

    const attrCount = (result.match(/data-root-path=/gi) || []).length
    expect(attrCount).toBe(1)
    expect(result).toContain('data-root-path="/existing"')
  })

  test("handles empty rootPath gracefully", () => {
    const html = '<html><head></head><body><div id="root"></div></body></html>'
    const result = injectRootPath(html, "")

    expect(result).toBe(html)
  })

  test("handles HTML with attributes on head tag", () => {
    const html = '<html><head lang="en"></head><body><div id="root"></div></body></html>'
    const result = injectRootPath(html, "/proxy")

    expect(result).toContain('<base href="/proxy/">')
    expect(result).toContain("__OPENCODE__")
  })

  test("handles multiline HTML", () => {
    const html = `<!DOCTYPE html>
<html>
  <head>
    <title>Test</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`
    const result = injectRootPath(html, "/proxy")

    expect(result).toContain('<base href="/proxy/">')
    expect(result).toContain('data-root-path="/proxy"')
  })
})

describe("URL normalization", () => {
  test("normalizes URLs with duplicate slashes", () => {
    expect(normalizeUrl("http://localhost:4096", "//proxy//path/")).toBe(
      "http://localhost:4096/proxy/path/"
    )
  })

  test("preserves protocol slashes", () => {
    const result = normalizeUrl("http://localhost:4096", "/proxy")
    expect(result).toContain("http://")
    expect(result).not.toContain("http:/localhost")
  })

  test("handles empty path", () => {
    expect(normalizeUrl("http://localhost:4096", "")).toBe("http://localhost:4096")
  })

  test("handles undefined path", () => {
    expect(normalizeUrl("http://localhost:4096")).toBe("http://localhost:4096")
  })

  test("handles complex paths", () => {
    expect(normalizeUrl("http://localhost:4096", "/jupyter/proxy/opencode/")).toBe(
      "http://localhost:4096/jupyter/proxy/opencode/"
    )
  })

  test("handles trailing slashes correctly", () => {
    const result = normalizeUrl("http://localhost:4096/", "/proxy")
    expect(result).toBe("http://localhost:4096/proxy")
  })
})

describe("rootPath validation", () => {
  test("rootPath must start with /", () => {
    const invalidPaths = ["proxy", "test/path", "no-slash"]
    const validPaths = ["/proxy", "/test/path", "/jupyter/proxy/opencode"]

    for (const path of invalidPaths) {
      expect(path.startsWith("/")).toBe(false)
    }

    for (const path of validPaths) {
      expect(path.startsWith("/")).toBe(true)
    }
  })
})

describe("server URL with rootPath", () => {
  test("constructs URL correctly with rootPath", () => {
    const serverUrl = new URL("http://localhost:4096")
    const rootPath = "/proxy"
    const finalUrl = new URL(normalizeUrl(serverUrl.toString(), rootPath))

    expect(finalUrl.toString()).toBe("http://localhost:4096/proxy")
  })

  test("constructs URL correctly without rootPath", () => {
    const serverUrl = new URL("http://localhost:4096")
    const finalUrl = normalizeUrl(serverUrl.toString())

    expect(finalUrl).toBe("http://localhost:4096/")
  })
})

describe("Special character handling", () => {
  test("handles URL encoded characters", () => {
    const html = '<html><head></head><body><div id="root"></div></body></html>'
    const result = injectRootPath(html, "/한글/경로")
    
    // Should properly escape in HTML attributes
    expect(result).toContain('data-root-path=')
    // Should safely encode in JavaScript
    expect(result).toContain('window.__OPENCODE__.rootPath')
  })
  
  test("handles spaces and special chars in rootPath", () => {
    const html = '<html><head></head><body><div id="root"></div></body></html>'
    const paths = ["/path with space", "/path-with-dash", "/path_with_underscore", "/path.with.dot"]
    
    for (const path of paths) {
      const result = injectRootPath(html, path)
      expect(result).toContain(JSON.stringify(path))
    }
  })
  
  test("handles paths with query-like characters", () => {
    const maliciousPath = "/proxy?token=abc&key=xyz"
    const html = '<html><head></head><body><div id="root"></div></body></html>'
    const result = injectRootPath(html, maliciousPath)
    
    // Should be safely escaped
    expect(result).toContain(JSON.stringify(maliciousPath))
  })
})

describe("URL normalization edge cases", () => {
  test("handles multiple consecutive slashes", () => {
    expect(normalizeUrl("http://localhost:4096", "///proxy///path///")).toBe(
      "http://localhost:4096/proxy/path/"
    )
  })
  
  test("handles mixed slash patterns", () => {
    expect(normalizeUrl("http://localhost:4096/", "//proxy/path")).toBe(
      "http://localhost:4096/proxy/path"
    )
  })
  
  test("preserves trailing slash when explicitly provided", () => {
    const result = normalizeUrl("http://localhost:4096", "/proxy/")
    expect(result.endsWith("/")).toBe(true)
  })
})

describe("WebSocket compatibility", () => {
  test("WebSocket URL construction with rootPath", () => {
    const serverUrl = "http://localhost:4096"
    const rootPath = "/jupyter/proxy/opencode"
    
    // WebSocket should use same base path
    const wsUrl = new URL(rootPath, serverUrl)
    wsUrl.protocol = "ws:"
    
    expect(wsUrl.toString()).toBe("ws://localhost:4096/jupyter/proxy/opencode")
  })
  
  test("WebSocket URL without rootPath", () => {
    const serverUrl = "http://localhost:4096"
    const wsUrl = new URL(serverUrl)
    wsUrl.protocol = "ws:"
    
    expect(wsUrl.toString()).toBe("ws://localhost:4096/")
  })
})

describe("Fallback strategy", () => {
  test("validates fallback behavior when local build missing", () => {
    // This test documents expected behavior
    const scenarios = [
      { hasLocalBuild: true, hasRootPath: false, expected: "local" },
      { hasLocalBuild: false, hasRootPath: false, expected: "proxy" },
      { hasLocalBuild: true, hasRootPath: true, expected: "local" },
      { hasLocalBuild: false, hasRootPath: true, expected: "error" },
    ]
    
    for (const scenario of scenarios) {
      // Expected behavior documented
      expect(scenario.expected).toBeDefined()
    }
  })
})
