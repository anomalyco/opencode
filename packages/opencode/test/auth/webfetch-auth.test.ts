/**
 * Tests for the webfetch credential store.
 *
 * Covers:
 * - Token expiry detection
 * - Authorization header generation (Bearer + Basic)
 * - UTF-8 Basic auth encoding (RFC 7617 §2.1)
 * - Token refresh via RFC 6749 §6 with resource parameter (RFC 8707 §2.2)
 * - Token refresh token_type validation (RFC 6749 §5.1)
 * - lookup() three-tier matching: exact, origin, and prefix matching
 * - resolveCredentials() auto-refresh on expired tokens
 * - store get/set/remove
 */
import { describe, test, expect, afterEach } from "bun:test"
import { expired, headers, refresh, lookup, resolveCredentials, store } from "../../src/auth/webfetch-auth"
import type { Credential, CredentialStore } from "../../src/auth/webfetch-auth"
import type { ASMetadata } from "../../src/auth/discovery"

// In-memory credential store for unit testing lookup and resolve logic
// without file I/O dependencies.
class MemoryStore implements CredentialStore {
  private data: Record<string, Credential> = {}
  async get(resource: string) { return this.data[resource] }
  async set(resource: string, cred: Credential) { this.data[resource] = cred }
  async remove(resource: string) { delete this.data[resource] }
  async all() { return { ...this.data } }
}

// ---------------------------------------------------------------------------
// expired() — token expiry detection
// ---------------------------------------------------------------------------

describe("expired()", () => {
  test("returns false when no expires_at is set", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "test",
    }
    expect(expired(cred)).toBe(false)
  })

  test("returns false when token is not yet expired", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "test",
      expires_at: Date.now() / 1000 + 3600, // 1 hour from now
    }
    expect(expired(cred)).toBe(false)
  })

  test("returns true when token is expired", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "test",
      expires_at: Date.now() / 1000 - 60, // 1 minute ago
    }
    expect(expired(cred)).toBe(true)
  })

  test("uses 30-second buffer before actual expiry", () => {
    // Token expires in 20 seconds — within buffer, should be considered expired
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "test",
      expires_at: Date.now() / 1000 + 20,
    }
    expect(expired(cred)).toBe(true)
  })

  test("token expiring in 31+ seconds is not expired", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "test",
      expires_at: Date.now() / 1000 + 31,
    }
    expect(expired(cred)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// headers() — Authorization header generation
// ---------------------------------------------------------------------------

describe("headers()", () => {
  test("generates Bearer Authorization header", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "mytoken123",
    }
    expect(headers(cred)).toEqual({ Authorization: "Bearer mytoken123" })
  })

  test("returns empty object for bearer without access_token", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
    }
    expect(headers(cred)).toEqual({})
  })

  test("generates Basic Authorization header with ASCII credentials", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "basic",
      username: "Aladdin",
      password: "open sesame",
    }
    const result = headers(cred)
    expect(result.Authorization).toBe("Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==")
  })

  test("generates Basic Authorization header with UTF-8 credentials (RFC 7617 §2.1)", () => {
    // RFC 7617 §2.1: the default charset is UTF-8
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "basic",
      username: "Jäsøn",
      password: "Dœ",
    }
    const result = headers(cred)
    // Verify it uses Buffer (UTF-8) not btoa (which would throw)
    const decoded = Buffer.from(result.Authorization!.replace("Basic ", ""), "base64").toString("utf-8")
    expect(decoded).toBe("Jäsøn:Dœ")
  })

  test("returns empty object for basic without username", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "basic",
      password: "test",
    }
    expect(headers(cred)).toEqual({})
  })

  test("returns empty object for basic without password", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "basic",
      username: "test",
    }
    expect(headers(cred)).toEqual({})
  })

  test("handles empty username and password for basic auth", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "basic",
      username: "",
      password: "",
    }
    const result = headers(cred)
    const decoded = Buffer.from(result.Authorization!.replace("Basic ", ""), "base64").toString("utf-8")
    expect(decoded).toBe(":")
  })

  test("rejects username containing : (RFC 7617 §2)", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "basic",
      username: "user:name",
      password: "pass",
    }
    expect(headers(cred)).toEqual({})
  })

  test("rejects bearer token with CRLF (header injection prevention, M7)", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "token\r\nX-Injected: evil",
    }
    expect(headers(cred)).toEqual({})
  })

  test("rejects bearer token with lone LF (M7)", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "token\nevil",
    }
    expect(headers(cred)).toEqual({})
  })

  test("rejects bearer token with lone CR (M7)", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "token\revil",
    }
    expect(headers(cred)).toEqual({})
  })

  test("allows normal bearer tokens without CR/LF", () => {
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.valid.token",
    }
    const result = headers(cred)
    expect(result.Authorization).toBe("Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.valid.token")
  })
})

// ---------------------------------------------------------------------------
// lookup() — credential lookup with three-tier matching
// ---------------------------------------------------------------------------

describe("lookup() prefix matching", () => {
  test("returns exact URL match over prefix match", async () => {
    const mem = new MemoryStore()
    await mem.set("https://api.example.com/v1", {
      resource: "https://api.example.com/v1",
      scheme: "bearer",
      access_token: "prefix-token",
    })
    await mem.set("https://api.example.com/v1/deep", {
      resource: "https://api.example.com/v1/deep",
      scheme: "bearer",
      access_token: "exact-token",
    })

    const result = await lookup("https://api.example.com/v1/deep", mem)
    expect(result).toBeDefined()
    expect(result!.access_token).toBe("exact-token")
  })

  test("returns origin match when no exact match exists", async () => {
    const mem = new MemoryStore()
    await mem.set("https://api.example.com", {
      resource: "https://api.example.com",
      scheme: "bearer",
      access_token: "origin-token",
    })

    const result = await lookup("https://api.example.com/other/path", mem)
    expect(result).toBeDefined()
    expect(result!.access_token).toBe("origin-token")
  })

  test("prefers longer prefix match over origin-wide credential", async () => {
    const mem = new MemoryStore()
    await mem.set("https://api.example.com", {
      resource: "https://api.example.com",
      scheme: "bearer",
      access_token: "origin-token",
    })
    await mem.set("https://api.example.com/v1/private", {
      resource: "https://api.example.com/v1/private",
      scheme: "bearer",
      access_token: "prefix-token",
    })

    const result = await lookup("https://api.example.com/v1/private/data", mem)
    expect(result).toBeDefined()
    expect(result!.access_token).toBe("prefix-token")
  })

  test("returns longest prefix match", async () => {
    const mem = new MemoryStore()
    await mem.set("https://api.example.com/v1", {
      resource: "https://api.example.com/v1",
      scheme: "bearer",
      access_token: "short-prefix",
    })
    await mem.set("https://api.example.com/v1/deep", {
      resource: "https://api.example.com/v1/deep",
      scheme: "bearer",
      access_token: "long-prefix",
    })

    const result = await lookup("https://api.example.com/v1/deep/nested", mem)
    expect(result).toBeDefined()
    expect(result!.access_token).toBe("long-prefix")
  })

  test("returns undefined when no match exists", async () => {
    const mem = new MemoryStore()
    const result = await lookup("https://nomatch.example.com/resource", mem)
    expect(result).toBeUndefined()
  })

  test("does not leak credentials across origins (evil.com attack)", async () => {
    const mem = new MemoryStore()
    await mem.set("https://api.example.com", {
      resource: "https://api.example.com",
      scheme: "bearer",
      access_token: "secret-token",
    })
    // api.example.com.evil.com is a different origin — must NOT match
    const result = await lookup("https://api.example.com.evil.com/steal", mem)
    expect(result).toBeUndefined()
  })

  test("does not match prefix at non-path boundary", async () => {
    const mem = new MemoryStore()
    await mem.set("https://api.example.com/v1", {
      resource: "https://api.example.com/v1",
      scheme: "bearer",
      access_token: "v1-token",
    })
    // /v1extra is not a path boundary match for /v1
    const result = await lookup("https://api.example.com/v1extra", mem)
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// store — integration tests for file-based persistence
// ---------------------------------------------------------------------------

describe("store get/set/remove", () => {
  const keys = [
    "https://api.example.com/v1",
    "https://api.example.com/v1/deep",
    "https://api.example.com",
  ]
  afterEach(async () => {
    for (const k of keys) await store.remove(k)
  })

  test("set and get round-trip", async () => {
    const cred: Credential = {
      resource: "https://api.example.com/v1",
      scheme: "bearer",
      access_token: "test-token",
    }
    await store.set("https://api.example.com/v1", cred)
    const result = await store.get("https://api.example.com/v1")
    expect(result).toBeDefined()
    expect(result!.access_token).toBe("test-token")
  })

  test("remove deletes credential", async () => {
    const cred: Credential = {
      resource: "https://api.example.com/v1",
      scheme: "bearer",
      access_token: "will-be-removed",
    }
    await store.set("https://api.example.com/v1", cred)
    await store.remove("https://api.example.com/v1")
    const result = await store.get("https://api.example.com/v1")
    expect(result).toBeUndefined()
  })

  test("all returns all stored credentials", async () => {
    await store.set("https://api.example.com/v1", {
      resource: "https://api.example.com/v1",
      scheme: "bearer",
      access_token: "token-1",
    })
    await store.set("https://api.example.com/v1/deep", {
      resource: "https://api.example.com/v1/deep",
      scheme: "bearer",
      access_token: "token-2",
    })
    const all = await store.all()
    expect(all["https://api.example.com/v1"]?.access_token).toBe("token-1")
    expect(all["https://api.example.com/v1/deep"]?.access_token).toBe("token-2")
  })
})

// ---------------------------------------------------------------------------
// resolveCredentials() — lookup + auto-refresh for expired tokens
// ---------------------------------------------------------------------------

describe("resolveCredentials()", () => {
  test("returns headers for valid non-expired credential", async () => {
    const mem = new MemoryStore()
    await mem.set("https://resolve-test.example.com", {
      resource: "https://resolve-test.example.com",
      scheme: "bearer",
      access_token: "valid-token",
      expires_at: Date.now() / 1000 + 3600,
    })

    const result = await resolveCredentials("https://resolve-test.example.com", mem)
    expect(result).toEqual({ Authorization: "Bearer valid-token" })
  })

  test("returns empty headers for expired credential without refresh_token", async () => {
    const mem = new MemoryStore()
    await mem.set("https://resolve-test.example.com", {
      resource: "https://resolve-test.example.com",
      scheme: "bearer",
      access_token: "expired-token",
      expires_at: Date.now() / 1000 - 60,
    })

    const result = await resolveCredentials("https://resolve-test.example.com", mem)
    expect(result).toEqual({})
  })

  test("returns empty headers when no credential exists", async () => {
    const mem = new MemoryStore()
    const result = await resolveCredentials("https://no-such-credential.example.com", mem)
    expect(result).toEqual({})
  })

  test("rejects refresh for credential with private-network issuer (M4)", async () => {
    const mem = new MemoryStore()
    await mem.set("https://resolve-test.example.com", {
      resource: "https://resolve-test.example.com",
      scheme: "bearer",
      access_token: "expired-token",
      refresh_token: "refresh-me",
      issuer: "https://169.254.169.254",
      expires_at: Date.now() / 1000 - 60,
    })
    const result = await resolveCredentials("https://resolve-test.example.com", mem)
    expect(result).toEqual({})
  })

  test("rejects refresh for credential with RFC 1918 issuer (M4)", async () => {
    const mem = new MemoryStore()
    await mem.set("https://resolve-test.example.com", {
      resource: "https://resolve-test.example.com",
      scheme: "bearer",
      access_token: "expired-token",
      refresh_token: "refresh-me",
      issuer: "https://10.0.0.1",
      expires_at: Date.now() / 1000 - 60,
    })
    const result = await resolveCredentials("https://resolve-test.example.com", mem)
    expect(result).toEqual({})
  })

  test("rejects refresh for credential with non-HTTPS issuer (M4)", async () => {
    const mem = new MemoryStore()
    await mem.set("https://resolve-test.example.com", {
      resource: "https://resolve-test.example.com",
      scheme: "bearer",
      access_token: "expired-token",
      refresh_token: "refresh-me",
      issuer: "http://evil.example.com",
      expires_at: Date.now() / 1000 - 60,
    })
    const result = await resolveCredentials("https://resolve-test.example.com", mem)
    expect(result).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// refresh() — token refresh via RFC 6749 §6
// ---------------------------------------------------------------------------

describe("refresh() (RFC 6749 §6)", () => {
  const servers: ReturnType<typeof Bun.serve>[] = []
  afterEach(() => {
    for (const s of servers) s.stop()
    servers.length = 0
  })

  test("returns undefined without refresh_token", async () => {
    const mem = new MemoryStore()
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "expired",
    }
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      token_endpoint: "https://as.example.com/token",
      response_types_supported: ["code"],
    }
    const result = await refresh(cred, meta, mem)
    expect(result).toBeUndefined()
  })

  test("returns undefined without token_endpoint", async () => {
    const mem = new MemoryStore()
    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "expired",
      refresh_token: "refresh-me",
    }
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      response_types_supported: ["code"],
    }
    const result = await refresh(cred, meta, mem)
    expect(result).toBeUndefined()
  })

  test("refreshes token successfully", async () => {
    const mem = new MemoryStore()
    const s = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = new URLSearchParams(await req.text())
        // Verify RFC 6749 §6 request format
        expect(body.get("grant_type")).toBe("refresh_token")
        expect(body.get("refresh_token")).toBe("old-refresh-token")
        expect(body.get("client_id")).toBe("my-client")
        // RFC 8707 §2.2: resource parameter must be included
        expect(body.get("resource")).toBe("https://example.com")

        return new Response(
          JSON.stringify({
            access_token: "new-access-token",
            token_type: "Bearer",
            refresh_token: "new-refresh-token",
            expires_in: 3600,
            scope: "read write",
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "old-access-token",
      refresh_token: "old-refresh-token",
      oauth_client_id: "my-client",
    }
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await refresh(cred, meta, mem)
    expect(result).toBeDefined()
    expect(result!.access_token).toBe("new-access-token")
    expect(result!.refresh_token).toBe("new-refresh-token")
    expect(result!.scope).toBe("read write")
    expect(result!.expires_at).toBeDefined()
  })

  test("preserves old refresh_token when new one not provided", async () => {
    const mem = new MemoryStore()
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({
            access_token: "new-access-token",
            token_type: "Bearer",
            expires_in: 1800,
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "old",
      refresh_token: "keep-this",
    }
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await refresh(cred, meta, mem)
    expect(result).toBeDefined()
    expect(result!.refresh_token).toBe("keep-this")
  })

  test("returns undefined on refresh failure (HTTP 400)", async () => {
    const mem = new MemoryStore()
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: "invalid_grant" }),
          { status: 400 },
        )
      },
    })
    servers.push(s)

    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "old",
      refresh_token: "bad-token",
    }
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await refresh(cred, meta, mem)
    expect(result).toBeUndefined()
  })

  test("uses client_secret_post when the AS requires it", async () => {
    const mem = new MemoryStore()
    const s = Bun.serve({
      port: 0,
      async fetch(req) {
        expect(req.headers.get("authorization")).toBeNull()
        const body = new URLSearchParams(await req.text())
        expect(body.get("client_id")).toBe("my-client")
        expect(body.get("client_secret")).toBe("my-secret")

        return new Response(
          JSON.stringify({ access_token: "new-token", token_type: "Bearer" }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "old",
      refresh_token: "refresh-me",
      oauth_client_id: "my-client",
      oauth_client_secret: "my-secret",
    }
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
    }
    const result = await refresh(cred, meta, mem)
    expect(result).toBeDefined()
    expect(result!.access_token).toBe("new-token")
  })

  test("uses client_secret_basic by default for confidential clients", async () => {
    const mem = new MemoryStore()
    const s = Bun.serve({
      port: 0,
      async fetch(req) {
        expect(req.headers.get("authorization")).toBe(`Basic ${Buffer.from("my-client:my-secret", "utf-8").toString("base64")}`)
        const body = new URLSearchParams(await req.text())
        expect(body.get("client_id")).toBeNull()
        expect(body.get("client_secret")).toBeNull()

        return new Response(
          JSON.stringify({ access_token: "new-token", token_type: "Bearer" }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "old",
      refresh_token: "refresh-me",
      oauth_client_id: "my-client",
      oauth_client_secret: "my-secret",
    }
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await refresh(cred, meta, mem)
    expect(result).toBeDefined()
    expect(result!.access_token).toBe("new-token")
  })

  test("returns undefined when no supported token auth method exists for a confidential client", async () => {
    const mem = new MemoryStore()
    let hit = false
    const s = Bun.serve({
      port: 0,
      fetch() {
        hit = true
        return new Response(JSON.stringify({ access_token: "new-token", token_type: "Bearer" }), {
          headers: { "Content-Type": "application/json" },
        })
      },
    })
    servers.push(s)

    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "old",
      refresh_token: "refresh-me",
      oauth_client_id: "my-client",
      oauth_client_secret: "my-secret",
    }
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
      token_endpoint_auth_methods_supported: ["private_key_jwt"],
    }
    const result = await refresh(cred, meta, mem)
    expect(result).toBeUndefined()
    expect(hit).toBe(false)
  })

  test("rejects refresh response missing token_type (RFC 6749 §5.1)", async () => {
    const mem = new MemoryStore()
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ access_token: "new-token" }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "old",
      refresh_token: "refresh-me",
    }
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await refresh(cred, meta, mem)
    expect(result).toBeUndefined()
  })

  test("rejects refresh response with non-Bearer token_type (RFC 6749 §5.1)", async () => {
    const mem = new MemoryStore()
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ access_token: "new-token", token_type: "mac" }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "old",
      refresh_token: "refresh-me",
    }
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await refresh(cred, meta, mem)
    expect(result).toBeUndefined()
  })

  test("accepts case-insensitive Bearer token_type in refresh (RFC 6749 §5.1)", async () => {
    const mem = new MemoryStore()
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ access_token: "new-token", token_type: "BEARER" }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "old",
      refresh_token: "refresh-me",
    }
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await refresh(cred, meta, mem)
    expect(result).toBeDefined()
    expect(result!.access_token).toBe("new-token")
  })

  test("rejects redirecting token_endpoint (redirect: error)", async () => {
    const mem = new MemoryStore()
    // A malicious AS could redirect the refresh POST to an internal service,
    // leaking refresh tokens, client secrets, and resource identifiers.
    let targetHit = false
    const target = Bun.serve({
      port: 0,
      fetch() {
        targetHit = true
        return new Response(
          JSON.stringify({ access_token: "stolen", token_type: "Bearer" }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(target)

    const redirector = Bun.serve({
      port: 0,
      fetch() {
        return new Response(null, {
          status: 302,
          headers: { Location: `http://127.0.0.1:${target.port as number}/steal` },
        })
      },
    })
    servers.push(redirector)

    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "old",
      refresh_token: "refresh-me",
      oauth_client_id: "my-client",
      oauth_client_secret: "my-secret",
    }
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      token_endpoint: `http://127.0.0.1:${redirector.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await refresh(cred, meta, mem)
    // Must fail — redirect: "error" causes fetch to throw, caught by .catch()
    expect(result).toBeUndefined()
    // The redirect target must never have received the refresh token
    expect(targetHit).toBe(false)
  })

  test("honors abort signal before refresh request", async () => {
    const mem = new MemoryStore()
    let hit = false
    const s = Bun.serve({
      port: 0,
      fetch() {
        hit = true
        return new Response(
          JSON.stringify({ access_token: "new-token", token_type: "Bearer" }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const ctrl = new AbortController()
    ctrl.abort()

    const cred: Credential = {
      resource: "https://example.com",
      scheme: "bearer",
      access_token: "old",
      refresh_token: "refresh-me",
    }
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await refresh(cred, meta, mem, undefined, ctrl.signal)
    expect(result).toBeUndefined()
    expect(hit).toBe(false)
  })
})
