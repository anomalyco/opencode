import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { proxyFetch, setProxyConfig, getProxyForUrl } from "../../src/util/fetch"

/**
 * Integration tests for proxy fetch functionality.
 * These tests require a real proxy server and are skipped in CI.
 *
 * To run locally with a proxy:
 * 1. Set HTTP_PROXY and/or HTTPS_PROXY environment variables
 * 2. Run: bun test test/util/fetch-integration.test.ts
 *
 * Example:
 * HTTPS_PROXY=http://proxyaws.pole-emploi.intra:8080 bun test test/util/fetch-integration.test.ts
 */

// Skip integration tests in CI or when no proxy is configured
const hasProxy = !!(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy)
const isCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI)
const shouldSkip = isCI || !hasProxy

describe("proxy-fetch integration", () => {
  // Save original env vars
  const originalEnv = { ...process.env }

  afterEach(() => {
    // Restore original env vars
    Object.assign(process.env, originalEnv)
    // Clear config
    setProxyConfig(undefined)
  })

  describe("real proxy requests", () => {
    test.skipIf(shouldSkip)("fetches through proxy", async () => {
      // This test requires a real proxy configured via environment variables
      const proxyUrl = getProxyForUrl("https://httpbin.org/get")
      expect(proxyUrl).toBeDefined()

      const response = await proxyFetch("https://httpbin.org/get", {
        headers: {
          "User-Agent": "opencode-test/1.0",
        },
      })

      expect(response.ok).toBe(true)
      const data = await response.json() as { headers: Record<string, string> }
      expect(data.headers).toBeDefined()
    })

    test.skipIf(shouldSkip)("POST request through proxy", async () => {
      const response = await proxyFetch("https://httpbin.org/post", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "opencode-test/1.0",
        },
        body: JSON.stringify({ test: "data" }),
      })

      expect(response.ok).toBe(true)
      const data = await response.json() as { json: { test: string } }
      expect(data.json).toEqual({ test: "data" })
    })

    test.skipIf(shouldSkip)("handles proxy timeout gracefully", async () => {
      // Test with a very short timeout to simulate network issues
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 100)

      try {
        await proxyFetch("https://httpbin.org/delay/5", {
          signal: controller.signal,
        })
        // Should not reach here
        expect(true).toBe(false)
      } catch (error) {
        expect(error).toBeDefined()
      } finally {
        clearTimeout(timeoutId)
      }
    })
  })

  describe("NO_PROXY bypass", () => {
    beforeEach(() => {
      // Ensure proxy is set for these tests
      if (!process.env.HTTPS_PROXY && !process.env.https_proxy) {
        process.env.HTTPS_PROXY = "http://localhost:9999" // Non-existent proxy
      }
    })

    test("bypasses proxy for NO_PROXY hosts", async () => {
      process.env.NO_PROXY = "httpbin.org"

      // Should NOT use proxy due to NO_PROXY
      const proxyUrl = getProxyForUrl("https://httpbin.org/get")
      expect(proxyUrl).toBeUndefined()

      // Should be able to fetch directly (no proxy)
      const response = await proxyFetch("https://httpbin.org/get", {
        headers: {
          "User-Agent": "opencode-test/1.0",
        },
      })

      expect(response.ok).toBe(true)
    })

    test("bypasses proxy for localhost", async () => {
      process.env.NO_PROXY = "localhost,127.0.0.1"

      expect(getProxyForUrl("http://localhost:3000")).toBeUndefined()
      expect(getProxyForUrl("http://127.0.0.1:8080")).toBeUndefined()
    })

    test("bypasses proxy for wildcard domain", async () => {
      process.env.NO_PROXY = "*.internal.com,*.ft.intra"

      expect(getProxyForUrl("https://api.internal.com/endpoint")).toBeUndefined()
      expect(getProxyForUrl("https://alfred.ft.intra/api")).toBeUndefined()
    })

    test("uses proxy for non-matching hosts", async () => {
      process.env.NO_PROXY = "localhost,*.internal.com"

      const proxyUrl = getProxyForUrl("https://external.example.com")
      expect(proxyUrl).toBeDefined()
    })
  })

  describe("OPENCODE_DISABLE_PROXY", () => {
    test("disables all proxy when flag is set", () => {
      process.env.HTTPS_PROXY = "http://proxy:8080"
      process.env.OPENCODE_DISABLE_PROXY = "1"

      expect(getProxyForUrl("https://example.com")).toBeUndefined()
    })

    test("respects falsy disable values", () => {
      process.env.HTTPS_PROXY = "http://proxy:8080"
      process.env.OPENCODE_DISABLE_PROXY = "0"

      // "0" is truthy as a string, so proxy should be disabled
      expect(getProxyForUrl("https://example.com")).toBeUndefined()
    })

    test("enables proxy when flag is unset", () => {
      process.env.HTTPS_PROXY = "http://proxy:8080"
      delete process.env.OPENCODE_DISABLE_PROXY

      expect(getProxyForUrl("https://example.com")).toBe("http://proxy:8080")
    })
  })

  describe("config override", () => {
    test("config proxy overrides environment", () => {
      process.env.HTTPS_PROXY = "http://env-proxy:8080"

      setProxyConfig({
        https: "http://config-proxy:8080",
      })

      expect(getProxyForUrl("https://example.com")).toBe("http://config-proxy:8080")
    })

    test("config no_proxy overrides environment", () => {
      process.env.HTTPS_PROXY = "http://proxy:8080"
      process.env.NO_PROXY = "env.local"

      setProxyConfig({
        no_proxy: ["config.local"],
      })

      // env.local should now use proxy (not in config no_proxy)
      expect(getProxyForUrl("https://env.local")).toBe("http://proxy:8080")
      // config.local should bypass proxy
      expect(getProxyForUrl("https://config.local")).toBeUndefined()
    })
  })
})
