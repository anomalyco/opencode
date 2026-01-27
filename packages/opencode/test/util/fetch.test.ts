import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { getProxyConfig, shouldBypassProxy, getProxyForUrl, setProxyConfig, getTlsForProxy } from "../../src/util/fetch"

describe("proxy-fetch", () => {
  // Save original env vars
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear proxy-related env vars
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.NO_PROXY
    delete process.env.http_proxy
    delete process.env.https_proxy
    delete process.env.no_proxy
    delete process.env.OPENCODE_DISABLE_PROXY

    // Clear config
    setProxyConfig(undefined)
  })

  afterEach(() => {
    // Remove env vars introduced during tests
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key]
      }
    }
    // Restore original env vars
    Object.assign(process.env, originalEnv)
  })

  describe("getProxyConfig", () => {
    test("returns empty config when no proxy configured", () => {
      const config = getProxyConfig()
      expect(config.http).toBeUndefined()
      expect(config.https).toBeUndefined()
      expect(config.noProxy).toEqual([])
    })

    test("reads HTTP_PROXY from environment", () => {
      process.env.HTTP_PROXY = "http://proxy:8080"
      const config = getProxyConfig()
      expect(config.http).toBe("http://proxy:8080")
    })

    test("reads http_proxy (lowercase) from environment", () => {
      process.env.http_proxy = "http://proxy:8080"
      const config = getProxyConfig()
      expect(config.http).toBe("http://proxy:8080")
    })

    test("reads HTTPS_PROXY from environment", () => {
      process.env.HTTPS_PROXY = "http://proxy:8443"
      const config = getProxyConfig()
      expect(config.https).toBe("http://proxy:8443")
    })

    test("reads https_proxy (lowercase) from environment", () => {
      process.env.https_proxy = "http://proxy:8443"
      const config = getProxyConfig()
      expect(config.https).toBe("http://proxy:8443")
    })

    test("reads NO_PROXY from environment", () => {
      process.env.NO_PROXY = "localhost,127.0.0.1,*.internal.com"
      const config = getProxyConfig()
      expect(config.noProxy).toEqual(["localhost", "127.0.0.1", "*.internal.com"])
    })

    test("handles NO_PROXY with spaces", () => {
      process.env.NO_PROXY = "localhost, 127.0.0.1 , *.internal.com"
      const config = getProxyConfig()
      expect(config.noProxy).toEqual(["localhost", "127.0.0.1", "*.internal.com"])
    })

    test("config overrides environment variables", () => {
      process.env.HTTP_PROXY = "http://env-proxy:8080"
      process.env.HTTPS_PROXY = "http://env-proxy:8443"
      process.env.NO_PROXY = "env.local"

      setProxyConfig({
        http: "http://config-proxy:8080",
        https: "http://config-proxy:8443",
        no_proxy: ["config.local"],
      })

      const config = getProxyConfig()
      expect(config.http).toBe("http://config-proxy:8080")
      expect(config.https).toBe("http://config-proxy:8443")
      expect(config.noProxy).toEqual(["config.local"])
    })

    test("partial config uses env for missing values", () => {
      process.env.HTTP_PROXY = "http://env-proxy:8080"
      process.env.HTTPS_PROXY = "http://env-proxy:8443"

      setProxyConfig({
        http: "http://config-proxy:8080",
        // https not set - should fall back to env
      })

      const config = getProxyConfig()
      expect(config.http).toBe("http://config-proxy:8080")
      expect(config.https).toBe("http://env-proxy:8443")
    })
  })

  describe("shouldBypassProxy", () => {
    test("returns false when noProxy is empty", () => {
      expect(shouldBypassProxy("example.com", [])).toBe(false)
    })

    test("matches wildcard *", () => {
      expect(shouldBypassProxy("any.host.com", ["*"])).toBe(true)
    })

    test("matches exact hostname", () => {
      expect(shouldBypassProxy("localhost", ["localhost"])).toBe(true)
      expect(shouldBypassProxy("example.com", ["localhost"])).toBe(false)
    })

    test("matches wildcard pattern *.domain.com", () => {
      expect(shouldBypassProxy("sub.example.com", ["*.example.com"])).toBe(true)
      expect(shouldBypassProxy("deep.sub.example.com", ["*.example.com"])).toBe(true)
      expect(shouldBypassProxy("example.com", ["*.example.com"])).toBe(false)
      expect(shouldBypassProxy("notexample.com", ["*.example.com"])).toBe(false)
    })

    test("matches suffix pattern .domain.com", () => {
      expect(shouldBypassProxy("sub.example.com", [".example.com"])).toBe(true)
      expect(shouldBypassProxy("deep.sub.example.com", [".example.com"])).toBe(true)
      expect(shouldBypassProxy("example.com", [".example.com"])).toBe(false)
    })

    test("matches domain suffix without dot", () => {
      expect(shouldBypassProxy("sub.example.com", ["example.com"])).toBe(true)
      expect(shouldBypassProxy("api.example.com", ["example.com"])).toBe(true)
      // exact match
      expect(shouldBypassProxy("example.com", ["example.com"])).toBe(true)
    })

    test("is case insensitive", () => {
      expect(shouldBypassProxy("LOCALHOST", ["localhost"])).toBe(true)
      expect(shouldBypassProxy("localhost", ["LOCALHOST"])).toBe(true)
      expect(shouldBypassProxy("Sub.Example.COM", ["*.example.com"])).toBe(true)
    })

    test("handles IP addresses", () => {
      expect(shouldBypassProxy("127.0.0.1", ["127.0.0.1"])).toBe(true)
      expect(shouldBypassProxy("192.168.1.100", ["192.168.1.*"])).toBe(false) // Not a valid pattern
      expect(shouldBypassProxy("192.168.1.100", ["192.168.1.100"])).toBe(true)
    })

    test("handles multiple patterns", () => {
      const noProxy = ["localhost", "127.0.0.1", "*.internal.com", ".ft.intra"]
      expect(shouldBypassProxy("localhost", noProxy)).toBe(true)
      expect(shouldBypassProxy("127.0.0.1", noProxy)).toBe(true)
      expect(shouldBypassProxy("api.internal.com", noProxy)).toBe(true)
      expect(shouldBypassProxy("service.ft.intra", noProxy)).toBe(true)
      expect(shouldBypassProxy("external.com", noProxy)).toBe(false)
    })
  })

  describe("getProxyForUrl", () => {
    test("returns undefined when no proxy configured", () => {
      expect(getProxyForUrl("https://example.com")).toBeUndefined()
    })

    test("returns HTTPS proxy for https URLs", () => {
      process.env.HTTPS_PROXY = "http://proxy:8443"
      expect(getProxyForUrl("https://example.com")).toBe("http://proxy:8443")
    })

    test("returns HTTP proxy for http URLs", () => {
      process.env.HTTP_PROXY = "http://proxy:8080"
      expect(getProxyForUrl("http://example.com")).toBe("http://proxy:8080")
    })

    test("accepts URL object", () => {
      process.env.HTTPS_PROXY = "http://proxy:8443"
      expect(getProxyForUrl(new URL("https://example.com/path"))).toBe("http://proxy:8443")
    })

    test("returns undefined for NO_PROXY hosts", () => {
      process.env.HTTPS_PROXY = "http://proxy:8443"
      process.env.NO_PROXY = "*.ft.intra,localhost"

      expect(getProxyForUrl("https://external.com")).toBe("http://proxy:8443")
      expect(getProxyForUrl("https://alfred.ft.intra/api")).toBeUndefined()
      expect(getProxyForUrl("https://localhost:3000")).toBeUndefined()
    })

    test("returns undefined when OPENCODE_DISABLE_PROXY is set", () => {
      process.env.HTTPS_PROXY = "http://proxy:8443"
      process.env.OPENCODE_DISABLE_PROXY = "1"

      expect(getProxyForUrl("https://example.com")).toBeUndefined()
    })
  })

  describe("getTlsForProxy", () => {
    test("returns undefined when no TLS config", () => {
      setProxyConfig({ https: "http://proxy:8080" })
      expect(getTlsForProxy()).toBeUndefined()
    })

    test("returns undefined when TLS object is empty", () => {
      setProxyConfig({
        https: "http://proxy:8080",
        tls: {},
      })
      expect(getTlsForProxy()).toBeUndefined()
    })

    test("returns rejectUnauthorized when set to false", () => {
      setProxyConfig({
        https: "http://proxy:8080",
        tls: { rejectUnauthorized: false },
      })
      const tls = getTlsForProxy()
      expect(tls).toBeDefined()
      expect(tls?.rejectUnauthorized).toBe(false)
    })

    test("returns rejectUnauthorized when set to true", () => {
      setProxyConfig({
        https: "http://proxy:8080",
        tls: { rejectUnauthorized: true },
      })
      const tls = getTlsForProxy()
      expect(tls).toBeDefined()
      expect(tls?.rejectUnauthorized).toBe(true)
    })

    test("returns ca as array when single path", () => {
      setProxyConfig({
        https: "http://proxy:8080",
        tls: { ca: "/path/to/ca.pem" },
      })
      const tls = getTlsForProxy()
      expect(tls).toBeDefined()
      expect(Array.isArray(tls?.ca)).toBe(true)
    })

    test("returns ca as array when multiple paths", () => {
      setProxyConfig({
        https: "http://proxy:8080",
        tls: { ca: ["/path/to/ca1.pem", "/path/to/ca2.pem"] },
      })
      const tls = getTlsForProxy()
      expect(tls).toBeDefined()
      expect(Array.isArray(tls?.ca)).toBe(true)
    })

    test("throws on path traversal attempt", () => {
      setProxyConfig({
        https: "http://proxy:8080",
        tls: { ca: "../../../etc/passwd" },
      })
      expect(() => getTlsForProxy()).toThrow("path traversal")
    })
  })
})
