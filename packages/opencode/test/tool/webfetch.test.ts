import { describe, expect, test } from "bun:test"
import { WebFetchTool } from "../../src/tool/webfetch"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

async function execute(url: string) {
  const tool = await WebFetchTool.init()
  return tool.execute({ url, format: "text" as const }, ctx)
}

// Mirrors the SSRF check in webfetch.ts so we can unit-test hostname
// classification without making real network requests.
function isBlocked(hostname: string) {
  return (
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^0\./.test(hostname) ||
    hostname === "localhost" ||
    hostname === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(hostname)
  )
}

describe("webfetch SSRF protection", () => {
  describe("blocks private IPv4 addresses", () => {
    const blocked = [
      // loopback
      "http://127.0.0.1/test",
      "http://127.0.0.255/test",
      "http://127.255.255.255/test",
      // class A private
      "http://10.0.0.1/test",
      "http://10.255.255.255/test",
      // class B private (172.16.0.0 - 172.31.255.255)
      "http://172.16.0.1/test",
      "http://172.20.0.1/test",
      "http://172.31.255.255/test",
      // class C private
      "http://192.168.1.1/test",
      "http://192.168.0.0/test",
      "http://192.168.255.255/test",
      // link-local
      "http://169.254.1.1/test",
      "http://169.254.169.254/test",
      // localhost
      "http://localhost/test",
      "http://localhost:8080/test",
      // 0.x.x.x
      "http://0.0.0.0/test",
      "http://0.1.2.3/test",
    ]

    for (const url of blocked) {
      test(url, async () => {
        expect(execute(url)).rejects.toThrow("Cannot fetch from private/internal network addresses")
      })
    }
  })

  describe("allows public addresses (hostname check)", () => {
    // Test the hostname classification directly to avoid making real
    // network requests. These hostnames must NOT be flagged as private.
    const allowed = [
      { url: "http://8.8.8.8/test", hostname: "8.8.8.8" },
      { url: "http://1.1.1.1/test", hostname: "1.1.1.1" },
      { url: "http://203.0.113.1/test", hostname: "203.0.113.1" },
      { url: "https://example.com/test", hostname: "example.com" },
      { url: "http://172.15.255.255/test", hostname: "172.15.255.255" }, // just below 172.16
      { url: "http://172.32.0.1/test", hostname: "172.32.0.1" }, // just above 172.31
      { url: "http://11.0.0.1/test", hostname: "11.0.0.1" },
      { url: "http://128.0.0.1/test", hostname: "128.0.0.1" },
      { url: "http://169.255.0.1/test", hostname: "169.255.0.1" }, // 169.255 is not link-local
      { url: "http://192.169.1.1/test", hostname: "192.169.1.1" }, // 192.169 is not private
    ]

    for (const { url, hostname } of allowed) {
      test(url, () => {
        expect(isBlocked(hostname)).toBe(false)
        // Also verify URL parses to the expected hostname
        expect(new URL(url).hostname).toBe(hostname)
      })
    }
  })

  describe("validates URL scheme", () => {
    test("rejects ftp://", async () => {
      expect(execute("ftp://example.com/file")).rejects.toThrow("URL must start with http:// or https://")
    })

    test("rejects file://", async () => {
      expect(execute("file:///etc/passwd")).rejects.toThrow("URL must start with http:// or https://")
    })

    test("rejects javascript:", async () => {
      expect(execute("javascript:alert(1)")).rejects.toThrow("URL must start with http:// or https://")
    })

    test("rejects data:", async () => {
      expect(execute("data:text/html,<h1>hi</h1>")).rejects.toThrow("URL must start with http:// or https://")
    })

    test("rejects bare string", async () => {
      expect(execute("not-a-url")).rejects.toThrow("URL must start with http:// or https://")
    })
  })

  describe("edge cases", () => {
    test("blocks 0.0.0.0", async () => {
      expect(execute("http://0.0.0.0/test")).rejects.toThrow("Cannot fetch from private/internal network addresses")
    })

    test("blocks metadata endpoint 169.254.169.254", async () => {
      expect(execute("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
        "Cannot fetch from private/internal network addresses",
      )
    })

    test("private IP with port is still blocked", async () => {
      expect(execute("http://127.0.0.1:3000/api")).rejects.toThrow(
        "Cannot fetch from private/internal network addresses",
      )
    })

    test("private IP with auth is still blocked", async () => {
      expect(execute("http://user:pass@127.0.0.1/api")).rejects.toThrow(
        "Cannot fetch from private/internal network addresses",
      )
    })

    test("private IP with path traversal is still blocked", async () => {
      expect(execute("http://10.0.0.1/../../../etc/passwd")).rejects.toThrow(
        "Cannot fetch from private/internal network addresses",
      )
    })
  })

  describe("IPv6 handling", () => {
    // NOTE: Bun's URL parser returns IPv6 hostnames with brackets (e.g. "[::1]"),
    // unlike Node.js which strips them. The current SSRF regex checks don't account
    // for this, so IPv6 private addresses are NOT blocked. These tests document the
    // current behavior. When the implementation is fixed, update these tests.

    test("hostname for IPv6 URLs includes brackets in Bun", () => {
      expect(new URL("http://[::1]/test").hostname).toBe("[::1]")
      expect(new URL("http://[fc00::1]/test").hostname).toBe("[fc00::1]")
    })

    test("isBlocked correctly identifies bare IPv6 loopback", () => {
      // Without brackets the regex works
      expect(isBlocked("::1")).toBe(true)
    })

    test("isBlocked correctly identifies bare fc00:: ULA", () => {
      expect(isBlocked("fc00::1")).toBe(true)
      expect(isBlocked("fd00::1")).toBe(true)
    })

    test("isBlocked does not match bracketed IPv6 (Bun URL.hostname format)", () => {
      // Documents current behavior: brackets prevent regex match
      expect(isBlocked("[::1]")).toBe(false)
      expect(isBlocked("[fc00::1]")).toBe(false)
      expect(isBlocked("[fd00::1]")).toBe(false)
    })
  })

  describe("172.x boundary precision", () => {
    // 172.16.0.0 - 172.31.255.255 is private, rest of 172.x is public
    test("blocks 172.16.0.0 (lower bound)", () => {
      expect(isBlocked("172.16.0.0")).toBe(true)
    })

    test("blocks 172.31.255.255 (upper bound)", () => {
      expect(isBlocked("172.31.255.255")).toBe(true)
    })

    test("allows 172.15.255.255 (just below range)", () => {
      expect(isBlocked("172.15.255.255")).toBe(false)
    })

    test("allows 172.32.0.0 (just above range)", () => {
      expect(isBlocked("172.32.0.0")).toBe(false)
    })

    test("blocks all subnets 172.16-31", () => {
      for (let i = 16; i <= 31; i++) {
        expect(isBlocked(`172.${i}.0.1`)).toBe(true)
      }
    })

    test("allows 172.0-15 and 172.32+", () => {
      for (const i of [0, 1, 14, 15, 32, 33, 100, 255]) {
        expect(isBlocked(`172.${i}.0.1`)).toBe(false)
      }
    })
  })
})
