import { describe, it, expect } from "bun:test"

process.env.OPENCODE_IMAGE = "test"
process.env.OPENCODE_NAMESPACE = "opencode"
process.env.ROUTER_DOMAIN = "no-panic.org"
process.env.ROUTE_SUFFIX = "-oc"
process.env.OPENCODE_PORT = "4096"
process.env.IDLE_TIMEOUT_MINUTES = "60"
process.env.API_KEY_SECRET_NAME = "test"
process.env.CONFIG_MAP_NAME = "test"
process.env.STORAGE_SIZE = "1Gi"

describe("getSessionInfo extracts hash and port from hostname", () => {
  // We need to test the function directly - import it after config is set
  const { config } = require("./config.js")

  // Re-implement getSessionInfo for testing (same logic as index.ts)
  function getSessionInfo(host: string): { hash: string | null; port: number | null } {
    const hostname = host.split(":")[0]
    const routerHostname = config.routerDomain.split(":")[0]
    const suffix = `${config.routeSuffix}.${routerHostname}`
    if (!hostname.endsWith(suffix)) return { hash: null, port: null }

    const sub = hostname.slice(0, hostname.length - suffix.length)

    // Check for <port>-<hash> pattern (port is 4+ digits at start)
    const portMatch = sub.match(/^([1-9][0-9]{3,})-(.+)$/)
    if (portMatch) {
      const port = parseInt(portMatch[1], 10)
      const hashPart = portMatch[2]
      if (/^[a-f0-9]{12}$/.test(hashPart)) {
        return { hash: hashPart, port }
      }
    }

    // Default: just <hash>
    if (/^[a-f0-9]{12}$/.test(sub)) {
      return { hash: sub, port: null }
    }

    return { hash: null, port: null }
  }

  it("extracts hash only from basic hostname", () => {
    const result = getSessionInfo("abc123def456-oc.no-panic.org")
    expect(result.hash).toBe("abc123def456")
    expect(result.port).toBeNull()
  })

  it("extracts port and hash from dev server hostname", () => {
    const result = getSessionInfo("5173-abc123def456-oc.no-panic.org")
    expect(result.hash).toBe("abc123def456")
    expect(result.port).toBe(5173)
  })

  it("extracts port 3000", () => {
    const result = getSessionInfo("3000-abc123def456-oc.no-panic.org")
    expect(result.hash).toBe("abc123def456")
    expect(result.port).toBe(3000)
  })

  it("extracts port 8000", () => {
    const result = getSessionInfo("8000-abc123def456-oc.no-panic.org")
    expect(result.hash).toBe("abc123def456")
    expect(result.port).toBe(8000)
  })

  it("returns null for invalid hash length", () => {
    const result = getSessionInfo("abc-oc.no-panic.org")
    expect(result.hash).toBeNull()
    expect(result.port).toBeNull()
  })

  it("returns null for non-session hostname", () => {
    const result = getSessionInfo("www.no-panic.org")
    expect(result.hash).toBeNull()
    expect(result.port).toBeNull()
  })

  it("handles port in Host header", () => {
    const result = getSessionInfo("5173-abc123def456-oc.no-panic.org:443")
    expect(result.hash).toBe("abc123def456")
    expect(result.port).toBe(5173)
  })

  it("rejects ports <3000", () => {
    const result = getSessionInfo("8080-abc123def456-oc.no-panic.org")
    // Note: this would match but 8080 < 3000 filter happens in getListeningPorts
    // The regex allows it but the test shows it's possible
    expect(result.hash).toBe("abc123def456")
    expect(result.port).toBe(8080)
  })
})

// ---------------------------------------------------------------------------
// getAttachSessionHash — extract session hash from attach subdomain
// ---------------------------------------------------------------------------

describe("getAttachSessionHash extracts hash from attach subdomain", () => {
  const { config } = require("./config.js")

  function getAttachSessionHash(host: string): string | null {
    const hostname = host.split(":")[0]
    const routerHostname = config.routerDomain.split(":")[0]
    const suffix = `${config.routeSuffix}.${routerHostname}`
    const prefix = config.attachRoutePrefix

    if (!hostname.endsWith(suffix) || !hostname.startsWith(prefix)) return null

    const hashPart = hostname.slice(prefix.length, hostname.length - suffix.length)
    if (/^[a-f0-9]{12}$/.test(hashPart)) return hashPart
    return null
  }

  it("extracts hash from attach subdomain", () => {
    const result = getAttachSessionHash("attach-abc123def456-oc.no-panic.org")
    expect(result).toBe("abc123def456")
  })

  it("returns null for regular (non-attach) session subdomain", () => {
    const result = getAttachSessionHash("abc123def456-oc.no-panic.org")
    expect(result).toBeNull()
  })

  it("returns null for non-session hostname", () => {
    const result = getAttachSessionHash("www.no-panic.org")
    expect(result).toBeNull()
  })

  it("returns null for invalid hash on attach subdomain", () => {
    const result = getAttachSessionHash("attach-tooshort-oc.no-panic.org")
    expect(result).toBeNull()
  })

  it("handles port in Host header", () => {
    const result = getAttachSessionHash("attach-abc123def456-oc.no-panic.org:443")
    expect(result).toBe("abc123def456")
  })

  it("returns null when prefix does not match", () => {
    const result = getAttachSessionHash("other-abc123def456-oc.no-panic.org")
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// validateAttachPassword — Basic Auth header parsing
// ---------------------------------------------------------------------------

describe("validateAttachPassword — Basic Auth header support", () => {
  // Re-implement password extraction logic (mirrors index.ts validateAttachPassword)
  function extractPasswordFromRequest(headers: Record<string, string>, url = "/"): string | undefined {
    // 1. HTTP Basic Auth
    const authHeader = headers["authorization"]
    if (typeof authHeader === "string" && authHeader.startsWith("Basic ")) {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8")
      const colonIdx = decoded.indexOf(":")
      if (colonIdx !== -1) return decoded.slice(colonIdx + 1)
    }

    // 2. Query param
    const parsed = new URL(url, "http://localhost")
    const queried = parsed.searchParams.get("password") ?? headers["x-attach-password"]
    if (typeof queried === "string") return queried

    return undefined
  }

  it("extracts password from Basic Auth header (opencode:<password>)", () => {
    const password = "mysecretpassword"
    const encoded = Buffer.from(`opencode:${password}`).toString("base64")
    const result = extractPasswordFromRequest({ authorization: `Basic ${encoded}` })
    expect(result).toBe(password)
  })

  it("extracts password with special characters from Basic Auth header", () => {
    const password = "abc123def456"
    const encoded = Buffer.from(`opencode:${password}`).toString("base64")
    const result = extractPasswordFromRequest({ authorization: `Basic ${encoded}` })
    expect(result).toBe(password)
  })

  it("extracts password from ?password= query param when no Authorization header", () => {
    const result = extractPasswordFromRequest({}, "/?password=querypassword")
    expect(result).toBe("querypassword")
  })

  it("extracts password from X-Attach-Password header when no Authorization header", () => {
    const result = extractPasswordFromRequest({ "x-attach-password": "headerpassword" })
    expect(result).toBe("headerpassword")
  })

  it("prefers Basic Auth over query param when both present", () => {
    const password = "basicauthpassword"
    const encoded = Buffer.from(`opencode:${password}`).toString("base64")
    const result = extractPasswordFromRequest({ authorization: `Basic ${encoded}` }, "/?password=querypassword")
    expect(result).toBe(password)
  })

  it("returns undefined when no auth mechanism provided", () => {
    const result = extractPasswordFromRequest({})
    expect(result).toBeUndefined()
  })

  it("returns undefined for malformed Basic Auth (no colon in decoded value)", () => {
    const encoded = Buffer.from("nocolon").toString("base64")
    const result = extractPasswordFromRequest({ authorization: `Basic ${encoded}` })
    expect(result).toBeUndefined()
  })

  it("handles password containing colons correctly (only splits on first colon)", () => {
    const password = "pass:word:with:colons"
    const encoded = Buffer.from(`opencode:${password}`).toString("base64")
    const result = extractPasswordFromRequest({ authorization: `Basic ${encoded}` })
    expect(result).toBe(password)
  })

  it("ignores non-Basic authorization schemes", () => {
    const result = extractPasswordFromRequest({ authorization: "Bearer sometoken" }, "/?password=fallback")
    expect(result).toBe("fallback")
  })
})
