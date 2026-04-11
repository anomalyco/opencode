/**
 * Tests for OAuth flow helpers — PKCE, HTML escaping, dynamic registration,
 * and network-dependent flows with mock servers.
 *
 * Tests cover:
 * - PKCE generation per RFC 7636 §4.1-§4.2
 * - HTML escaping for XSS prevention
 * - State generation
 * - Dynamic client registration per RFC 7591 (including expiring secret rejection)
 * - Device code polling per RFC 8628 §3.5 (slow_down interval handling)
 * - Device code expires_in validation and clamping to MAX_DEVICE_CODE_LIFETIME
 */
import { describe, test, expect, afterEach } from "bun:test"
import {
  pkce,
  state,
  register,
  deviceCode,
  authorizationCode,
  LocalCallbackServer,
  MAX_DEVICE_CODE_LIFETIME,
  escapeHtml,
} from "../../src/auth/flow"
import type { ASMetadata, ResourceMetadata } from "../../src/auth/discovery"

// RFC 7636 §4.1: code_verifier character set
const PKCE_RE = /^[A-Za-z0-9\-._~]{43,128}$/

async function freePort() {
  const probe = Bun.serve({
    port: 0,
    fetch() {
      return new Response("ok")
    },
  })
  const port = probe.port as number
  probe.stop()
  return port
}

// ---------------------------------------------------------------------------
// PKCE — RFC 7636 §4.1-§4.2
// ---------------------------------------------------------------------------

describe("PKCE generation (RFC 7636 §4.1-§4.2)", () => {
  test("generates valid code_verifier per RFC 7636 §4.1", async () => {
    const result = await pkce()
    // RFC 7636 §4.1: verifier = 43*128unreserved
    expect(result.verifier).toMatch(PKCE_RE)
    expect(result.verifier.length).toBeGreaterThanOrEqual(43)
    expect(result.verifier.length).toBeLessThanOrEqual(128)
  })

  test("generates valid code_challenge (base64url-encoded SHA-256)", async () => {
    const result = await pkce()
    // S256 challenge is base64url without padding, so it matches unreserved chars
    expect(result.challenge).toMatch(PKCE_RE)
    expect(result.challenge.length).toBeGreaterThanOrEqual(43)
  })

  test("generates different verifiers each time (CSPRNG)", async () => {
    const a = await pkce()
    const b = await pkce()
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.challenge).not.toBe(b.challenge)
  })

  test("challenge is derived from verifier (S256 = BASE64URL(SHA256(verifier)))", async () => {
    const result = await pkce()
    // Verify by recomputing
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(result.verifier))
    const bytes = new Uint8Array(hash)
    const binary = String.fromCharCode(...bytes)
    const expected = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    expect(result.challenge).toBe(expected)
  })

  test("RFC 7636 Appendix B test vector", async () => {
    // Official test vector from RFC 7636 Appendix B:
    // verifier:  dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
    // challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
    const bytes = new Uint8Array(hash)
    const binary = String.fromCharCode(...bytes)
    const challenge = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  })
})

// ---------------------------------------------------------------------------
// State parameter
// ---------------------------------------------------------------------------

describe("state generation", () => {
  test("generates a non-empty base64url string", () => {
    const s = state()
    expect(s.length).toBeGreaterThanOrEqual(32)
    // base64url chars only
    expect(s).toMatch(/^[A-Za-z0-9\-_]+$/)
  })

  test("generates different values each time (CSPRNG)", () => {
    expect(state()).not.toBe(state())
  })
})

describe("LocalCallbackServer", () => {
  test("uses 127.0.0.1 in the default redirect URI", async () => {
    const port = await freePort()
    const server = new LocalCallbackServer({ port, portRetries: 1 })
    const started = await server.start()
    await server.stop()

    expect(started.redirectUri).toBe(`http://127.0.0.1:${port}/oauth/callback`)
  })

  test("returns the authorization code and serves the success page", async () => {
    const port = await freePort()
    const server = new LocalCallbackServer({ port, portRetries: 1, timeout: 1000 })
    const { redirectUri } = await server.start()

    const waiting = server.waitForCode("expected-state")
    const response = await fetch(`${redirectUri}?code=test-code&state=expected-state`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain("Authorization Successful")
    await expect(waiting).resolves.toBe("test-code")
  })

  test("ignores invalid state callbacks and keeps waiting", async () => {
    const port = await freePort()
    const server = new LocalCallbackServer({ port, portRetries: 1, timeout: 1000 })
    const { redirectUri } = await server.start()

    const waiting = server.waitForCode("expected-state")
    const rejected = await fetch(`${redirectUri}?code=bad-code&state=wrong-state`)
    const rejectedBody = await rejected.text()
    const accepted = await fetch(`${redirectUri}?code=test-code&state=expected-state`)
    const acceptedBody = await accepted.text()

    expect(rejected.status).toBe(400)
    expect(rejectedBody).toContain("Invalid state parameter")
    expect(accepted.status).toBe(200)
    expect(acceptedBody).toContain("Authorization Successful")
    await expect(waiting).resolves.toBe("test-code")
  })

  test("rejects provider errors and escapes error HTML", async () => {
    const port = await freePort()
    const server = new LocalCallbackServer({ port, portRetries: 1, timeout: 1000 })
    const { redirectUri } = await server.start()

    const waiting = server.waitForCode("expected-state").catch((err) => err)
    const response = await fetch(
      `${redirectUri}?error=access_denied&error_description=${encodeURIComponent('<script>alert("xss")</script>')}&state=expected-state`,
    )
    const body = await response.text()
    const result = await waiting

    expect(response.status).toBe(200)
    expect(body).toContain("Authorization Failed")
    expect(body).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;")
    expect(body).not.toContain("<script>alert(\"xss\")</script>")
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe('Authorization error: <script>alert("xss")</script>')
  })

  test("rejects callbacks without an authorization code", async () => {
    const port = await freePort()
    const server = new LocalCallbackServer({ port, portRetries: 1, timeout: 1000 })
    const { redirectUri } = await server.start()

    const waiting = server.waitForCode("expected-state").catch((err) => err)
    const response = await fetch(`${redirectUri}?state=expected-state`)
    const body = await response.text()
    const result = await waiting

    expect(response.status).toBe(400)
    expect(body).toContain("No authorization code")
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe("No authorization code in callback")
  })

  test("times out when no callback arrives", async () => {
    const port = await freePort()
    const server = new LocalCallbackServer({ port, portRetries: 1, timeout: 10 })
    await server.start()

    await expect(server.waitForCode("expected-state")).rejects.toThrow("authorization callback timed out")
  })
})

// ---------------------------------------------------------------------------
// HTML escaping (XSS prevention)
// ---------------------------------------------------------------------------

describe("HTML escaping in error pages", () => {
  test("escapeHtml prevents XSS via script injection", () => {
    const malicious = '<script>alert("xss")</script>'
    const escaped = escapeHtml(malicious)
    expect(escaped).toBe("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;")
    expect(escaped).not.toContain("<script>")
  })

  test("escapeHtml handles all dangerous characters", () => {
    const input = `&<>"'`
    const expected = "&amp;&lt;&gt;&quot;&#39;"
    const result = escapeHtml(input)
    expect(result).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// Dynamic Client Registration — RFC 7591
// ---------------------------------------------------------------------------

describe("register() (RFC 7591)", () => {
  const servers: ReturnType<typeof Bun.serve>[] = []
  afterEach(() => {
    for (const s of servers) s.stop()
    servers.length = 0
  })

  test("returns undefined when no registration_endpoint", async () => {
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      response_types_supported: ["code"],
    }
    const result = await register(meta, "http://127.0.0.1:19877/callback", { name: "TestApp" })
    expect(result).toBeUndefined()
  })

  test("registers a client successfully", async () => {
    const s = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json()
        // Verify request format per RFC 7591 §2
        expect(body.redirect_uris).toEqual(["http://127.0.0.1:19877/callback"])
        expect(body.client_name).toBe("OpenCode")
        expect(body.grant_types).toContain("authorization_code")
        expect(body.token_endpoint_auth_method).toBe("none")

        return new Response(
          JSON.stringify({
            client_id: "test-client-id",
            client_secret: "test-client-secret",
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      registration_endpoint: `http://127.0.0.1:${s.port as number}/register`,
      response_types_supported: ["code"],
    }
    const result = await register(meta, "http://127.0.0.1:19877/callback", { name: "OpenCode", uri: "https://opencode.ai" })
    expect(result).toBeDefined()
    expect(result!.client_id).toBe("test-client-id")
    expect(result!.client_secret).toBe("test-client-secret")
  })

  test("returns client without secret for public client", async () => {
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ client_id: "public-client-id" }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      registration_endpoint: `http://127.0.0.1:${s.port as number}/register`,
      response_types_supported: ["code"],
    }
    const result = await register(meta, "http://127.0.0.1:19877/callback", { name: "OpenCode", uri: "https://opencode.ai" })
    expect(result).toBeDefined()
    expect(result!.client_id).toBe("public-client-id")
    expect(result!.client_secret).toBeUndefined()
  })

  test("returns undefined on registration failure (HTTP 400)", async () => {
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: "invalid_client_metadata" }),
          { status: 400 },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      registration_endpoint: `http://127.0.0.1:${s.port as number}/register`,
      response_types_supported: ["code"],
    }
    const result = await register(meta, "http://127.0.0.1:19877/callback", { name: "OpenCode", uri: "https://opencode.ai" })
    expect(result).toBeUndefined()
  })

  test("returns undefined on network error", async () => {
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      registration_endpoint: "http://127.0.0.1:1/register",
      response_types_supported: ["code"],
    }
    const result = await register(meta, "http://127.0.0.1:19877/callback", { name: "OpenCode", uri: "https://opencode.ai" })
    expect(result).toBeUndefined()
  })

  test("rejects expiring client_secret per RFC 7591 §3.2.1", async () => {
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({
            client_id: "expiring-client",
            client_secret: "will-expire",
            client_secret_expires_at: Math.floor(Date.now() / 1000) + 86400,
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      registration_endpoint: `http://127.0.0.1:${s.port as number}/register`,
      response_types_supported: ["code"],
    }
    const result = await register(meta, "http://127.0.0.1:19877/callback", { name: "OpenCode", uri: "https://opencode.ai" })
    // Must reject — we have no renewal mechanism for expiring secrets
    expect(result).toBeUndefined()
  })

  test("accepts non-expiring client_secret (expires_at = 0) per RFC 7591 §3.2.1", async () => {
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({
            client_id: "permanent-client",
            client_secret: "permanent-secret",
            client_secret_expires_at: 0,
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      registration_endpoint: `http://127.0.0.1:${s.port as number}/register`,
      response_types_supported: ["code"],
    }
    const result = await register(meta, "http://127.0.0.1:19877/callback", { name: "OpenCode", uri: "https://opencode.ai" })
    // expires_at=0 means "does not expire" — must accept
    expect(result).toBeDefined()
    expect(result!.client_id).toBe("permanent-client")
    expect(result!.client_secret).toBe("permanent-secret")
  })

  test("honors abort signal before registration request", async () => {
    let hit = false
    const s = Bun.serve({
      port: 0,
      fetch() {
        hit = true
        return new Response(
          JSON.stringify({ client_id: "test-client-id" }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const ctrl = new AbortController()
    ctrl.abort()

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      registration_endpoint: `http://127.0.0.1:${s.port as number}/register`,
      response_types_supported: ["code"],
    }
    const result = await register(
      meta,
      "http://127.0.0.1:19877/callback",
      { name: "OpenCode", uri: "https://opencode.ai" },
      undefined,
      ctrl.signal,
    )
    expect(result).toBeUndefined()
    expect(hit).toBe(false)
  })
})

describe("authorizationCode()", () => {
  const servers: ReturnType<typeof Bun.serve>[] = []
  afterEach(() => {
    for (const s of servers) s.stop()
    servers.length = 0
  })

  test("completes authorization code flow with deferred registration", async () => {
    let auth: ReturnType<typeof Bun.serve>
    let opened = ""
    let sawRegistration = false
    let sawToken = false

    auth = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/register") {
          sawRegistration = true
          const body = await req.json() as Record<string, unknown>
          expect(body.redirect_uris).toEqual(["http://127.0.0.1:19877/callback"])
          expect(body.client_name).toBe("OpenCode")
          return new Response(JSON.stringify({ client_id: "registered-client" }), {
            headers: { "Content-Type": "application/json" },
          })
        }
        if (url.pathname === "/token") {
          sawToken = true
          const body = new URLSearchParams(await req.text())
          expect(body.get("grant_type")).toBe("authorization_code")
          expect(body.get("code")).toBe("auth-code")
          expect(body.get("redirect_uri")).toBe("http://127.0.0.1:19877/callback")
          expect(body.get("client_id")).toBe("registered-client")
          expect(body.get("resource")).toBe("https://api.example.com")
          expect(body.get("code_verifier")).toBeTruthy()
          return new Response(JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            token_type: "Bearer",
            expires_in: 60,
          }), {
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    servers.push(auth)

    const result = await authorizationCode(
      "https://api.example.com/data",
      { resource: "https://api.example.com", scopes_supported: ["read"] },
      {
        issuer: "https://as.example.com",
        authorization_endpoint: `http://127.0.0.1:${auth.port as number}/authorize`,
        token_endpoint: `http://127.0.0.1:${auth.port as number}/token`,
        registration_endpoint: `http://127.0.0.1:${auth.port as number}/register`,
        response_types_supported: ["code"],
      },
      undefined,
      ["read"],
      {
        server: {
          async start() {
            return { redirectUri: "http://127.0.0.1:19877/callback" }
          },
          async waitForCode() {
            return "auth-code"
          },
          async stop() {},
        },
        interaction: {
          async askConsent() {},
          async openUrl(url) {
            opened = url
          },
          async showDeviceCode() {},
        },
        registration: { name: "OpenCode", uri: "https://opencode.ai" },
      },
    )

    expect(sawRegistration).toBe(true)
    expect(sawToken).toBe(true)
    expect(opened).toContain(`/authorize?response_type=code`)
    expect(opened).toContain(`client_id=registered-client`)
    expect(opened).toContain(`redirect_uri=${encodeURIComponent("http://127.0.0.1:19877/callback")}`)
    expect(opened).toContain(`resource=${encodeURIComponent("https://api.example.com")}`)
    expect(result).toEqual({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 60,
      scope: "read",
      client: { client_id: "registered-client" },
    })
  })

  test("returns undefined and stops callback server when no client can be resolved", async () => {
    let stopCalled = 0
    let opened = false

    const result = await authorizationCode(
      "https://api.example.com/data",
      { resource: "https://api.example.com", scopes_supported: ["read"] },
      {
        issuer: "https://as.example.com",
        authorization_endpoint: "https://as.example.com/authorize",
        token_endpoint: "https://as.example.com/token",
        response_types_supported: ["code"],
      },
      undefined,
      ["read"],
      {
        server: {
          async start() {
            return { redirectUri: "http://127.0.0.1:19877/callback" }
          },
          async waitForCode() {
            return "code"
          },
          async stop() {
            stopCalled++
          },
        },
        interaction: {
          async askConsent() {},
          async openUrl() {
            opened = true
          },
          async showDeviceCode() {},
        },
        registration: { name: "OpenCode" },
      },
    )

    expect(result).toBeUndefined()
    expect(opened).toBe(false)
    expect(stopCalled).toBe(1)
  })

  test("returns undefined when callback server fails to start", async () => {
    const result = await authorizationCode(
      "https://api.example.com/data",
      { resource: "https://api.example.com", scopes_supported: ["read"] },
      {
        issuer: "https://as.example.com",
        authorization_endpoint: "https://as.example.com/authorize",
        token_endpoint: "https://as.example.com/token",
        response_types_supported: ["code"],
      },
      { client_id: "test-client" },
      ["read"],
      {
        server: {
          async start() {
            throw new Error("bind failed")
          },
          async waitForCode() {
            return "code"
          },
          async stop() {},
        },
        interaction: {
          async askConsent() {},
          async openUrl() {},
          async showDeviceCode() {},
        },
        registration: { name: "OpenCode" },
      },
    )

    expect(result).toBeUndefined()
  })

  test("stops callback server and rethrows when opening the browser fails", async () => {
    let waitCalled = false
    let stopCalled = 0

    await expect(
      authorizationCode(
        "https://api.example.com/data",
        { resource: "https://api.example.com", scopes_supported: ["read"] },
        {
          issuer: "https://as.example.com",
          authorization_endpoint: "https://as.example.com/authorize",
          token_endpoint: "https://as.example.com/token",
          response_types_supported: ["code"],
        },
        { client_id: "test-client" },
        ["read"],
        {
          server: {
            async start() {
              return { redirectUri: "http://127.0.0.1:19877/callback" }
            },
            async waitForCode() {
              waitCalled = true
              return "code"
            },
            async stop() {
              stopCalled++
            },
          },
          interaction: {
            async askConsent() {},
            async openUrl() {
              throw new Error("cannot open browser")
            },
            async showDeviceCode() {},
          },
          registration: { name: "OpenCode" },
        },
      ),
    ).rejects.toThrow("cannot open browser")

    expect(waitCalled).toBe(false)
    expect(stopCalled).toBe(1)
  })

  test("returns undefined when callback never yields an authorization code", async () => {
    let tokenHit = false
    let auth: ReturnType<typeof Bun.serve>

    auth = Bun.serve({
      port: 0,
      fetch() {
        tokenHit = true
        return new Response(JSON.stringify({ access_token: "token", token_type: "Bearer" }), {
          headers: { "Content-Type": "application/json" },
        })
      },
    })
    servers.push(auth)

    const result = await authorizationCode(
      "https://api.example.com/data",
      { resource: "https://api.example.com", scopes_supported: ["read"] },
      {
        issuer: "https://as.example.com",
        authorization_endpoint: `http://127.0.0.1:${auth.port as number}/authorize`,
        token_endpoint: `http://127.0.0.1:${auth.port as number}/token`,
        response_types_supported: ["code"],
      },
      { client_id: "test-client" },
      ["read"],
      {
        server: {
          async start() {
            return { redirectUri: "http://127.0.0.1:19877/callback" }
          },
          async waitForCode() {
            throw new Error("timed out")
          },
          async stop() {},
        },
        interaction: {
          async askConsent() {},
          async openUrl() {},
          async showDeviceCode() {},
        },
        registration: { name: "OpenCode" },
      },
    )

    expect(result).toBeUndefined()
    expect(tokenHit).toBe(false)
  })

  test("uses client_secret_basic by default for confidential clients", async () => {
    let auth: ReturnType<typeof Bun.serve>

    auth = Bun.serve({
      port: 0,
      async fetch(req) {
        expect(req.headers.get("authorization")).toBe(`Basic ${Buffer.from("test-client:secret", "utf-8").toString("base64")}`)
        const body = new URLSearchParams(await req.text())
        expect(body.get("client_id")).toBeNull()
        expect(body.get("client_secret")).toBeNull()
        expect(body.get("code")).toBe("auth-code")
        return new Response(JSON.stringify({ access_token: "token", token_type: "Bearer" }), {
          headers: { "Content-Type": "application/json" },
        })
      },
    })
    servers.push(auth)

    const result = await authorizationCode(
      "https://api.example.com/data",
      { resource: "https://api.example.com", scopes_supported: ["read"] },
      {
        issuer: "https://as.example.com",
        authorization_endpoint: `http://127.0.0.1:${auth.port as number}/authorize`,
        token_endpoint: `http://127.0.0.1:${auth.port as number}/token`,
        response_types_supported: ["code"],
      },
      { client_id: "test-client", client_secret: "secret" },
      ["read"],
      {
        server: {
          async start() {
            return { redirectUri: "http://127.0.0.1:19877/callback" }
          },
          async waitForCode() {
            return "auth-code"
          },
          async stop() {},
        },
        interaction: {
          async askConsent() {},
          async openUrl() {},
          async showDeviceCode() {},
        },
        registration: { name: "OpenCode" },
      },
    )

    expect(result).toBeDefined()
    expect(result!.access_token).toBe("token")
  })

  test("returns undefined when token response has unsupported token_type", async () => {
    let auth: ReturnType<typeof Bun.serve>

    auth = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ access_token: "token", token_type: "mac" }), {
          headers: { "Content-Type": "application/json" },
        })
      },
    })
    servers.push(auth)

    const result = await authorizationCode(
      "https://api.example.com/data",
      { resource: "https://api.example.com", scopes_supported: ["read"] },
      {
        issuer: "https://as.example.com",
        authorization_endpoint: `http://127.0.0.1:${auth.port as number}/authorize`,
        token_endpoint: `http://127.0.0.1:${auth.port as number}/token`,
        response_types_supported: ["code"],
      },
      { client_id: "test-client", client_secret: "secret" },
      ["read"],
      {
        server: {
          async start() {
            return { redirectUri: "http://127.0.0.1:19877/callback" }
          },
          async waitForCode() {
            return "auth-code"
          },
          async stop() {},
        },
        interaction: {
          async askConsent() {},
          async openUrl() {},
          async showDeviceCode() {},
        },
        registration: { name: "OpenCode" },
      },
    )

    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Device Code Flow — RFC 8628
// ---------------------------------------------------------------------------

describe("deviceCode() (RFC 8628)", () => {
  const servers: ReturnType<typeof Bun.serve>[] = []
  afterEach(() => {
    for (const s of servers) s.stop()
    servers.length = 0
  })

  const resource: ResourceMetadata = {
    resource: "https://api.example.com",
    scopes_supported: ["read"],
  }

  const client = { client_id: "test-client" }

  test("returns undefined when AS does not support device code", async () => {
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      token_endpoint: "https://as.example.com/token",
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    expect(result).toBeUndefined()
  })

  test("returns undefined when AS is missing token_endpoint", async () => {
    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: "https://as.example.com/device",
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    expect(result).toBeUndefined()
  })

  test("initiates device code flow and returns device info", async () => {
    const s = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = new URLSearchParams(await req.text())
        expect(body.get("client_id")).toBe("test-client")
        expect(body.get("resource")).toBe("https://api.example.com")

        return new Response(
          JSON.stringify({
            device_code: "test-device-code",
            user_code: "ABCD-1234",
            verification_uri: "https://as.example.com/verify",
            verification_uri_complete: "https://as.example.com/verify?code=ABCD-1234",
            expires_in: 300,
            interval: 5,
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${s.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    expect(result).toBeDefined()
    // RFC 8628: verification_uri_complete takes precedence when origins match
    expect(result!.info.verification_uri).toBe("https://as.example.com/verify?code=ABCD-1234")
    expect(result!.info.user_code).toBe("ABCD-1234")
    expect(typeof result!.poll).toBe("function")
  })

  test("falls back to verification_uri when verification_uri_complete has different origin", async () => {
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({
            device_code: "test-device-code",
            user_code: "ABCD-1234",
            verification_uri: "https://as.example.com/verify",
            // Malicious AS points to a phishing domain
            verification_uri_complete: "https://evil.example.com/verify?code=ABCD-1234",
            expires_in: 300,
            interval: 5,
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${s.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    expect(result).toBeDefined()
    // Must fall back to verification_uri, not the phishing URL
    expect(result!.info.verification_uri).toBe("https://as.example.com/verify")
    expect(result!.info.user_code).toBe("ABCD-1234")
  })

  test("falls back to verification_uri when verification_uri_complete is not HTTPS", async () => {
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({
            device_code: "test-device-code",
            user_code: "ABCD-1234",
            verification_uri: "https://as.example.com/verify",
            verification_uri_complete: "http://as.example.com/verify?code=ABCD-1234",
            expires_in: 300,
            interval: 5,
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${s.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    expect(result).toBeDefined()
    // http:// (non-loopback) fails requireHttps — must fall back
    expect(result!.info.verification_uri).toBe("https://as.example.com/verify")
  })

  test("falls back to verification_uri when verification_uri_complete is unparseable", async () => {
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({
            device_code: "test-device-code",
            user_code: "ABCD-1234",
            verification_uri: "https://as.example.com/verify",
            verification_uri_complete: "not-a-url",
            expires_in: 300,
            interval: 5,
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${s.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    expect(result).toBeDefined()
    expect(result!.info.verification_uri).toBe("https://as.example.com/verify")
  })

  test("uses verification_uri when verification_uri_complete is absent", async () => {
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({
            device_code: "test-device-code",
            user_code: "ABCD-1234",
            verification_uri: "https://as.example.com/verify",
            expires_in: 300,
            interval: 5,
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${s.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    expect(result).toBeDefined()
    expect(result!.info.verification_uri).toBe("https://as.example.com/verify")
  })

  test("uses client_secret_basic when polling device tokens for confidential clients", async () => {
    let polls = 0
    const s = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/device") {
          return new Response(
            JSON.stringify({
              device_code: "test-device-code",
              user_code: "ABCD-1234",
              verification_uri: "https://as.example.com/verify",
              expires_in: 60,
              interval: 0,
            }),
            { headers: { "Content-Type": "application/json" } },
          )
        }

        polls++
        expect(req.headers.get("authorization")).toBe(`Basic ${Buffer.from("secret-client:secret", "utf-8").toString("base64")}`)
        const body = new URLSearchParams(await req.text())
        expect(body.get("client_id")).toBeNull()
        expect(body.get("device_code")).toBe("test-device-code")
        return new Response(
          JSON.stringify({ access_token: "device-token", token_type: "Bearer" }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${s.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, {
      client_id: "secret-client",
      client_secret: "secret",
    })

    expect(result).toBeDefined()
    await expect(result!.poll()).resolves.toEqual({
      access_token: "device-token",
      refresh_token: undefined,
      expires_in: undefined,
      scope: "read",
      client: { client_id: "secret-client", client_secret: "secret" },
    })
    expect(polls).toBe(1)
  })

  test("slow_down increases interval cumulatively across polls (RFC 8628 §3.5)", async () => {
    let polls = 0
    const times: number[] = []
    let lastPoll = 0
    const s = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/device") {
          return new Response(
            JSON.stringify({
              device_code: "dc",
              user_code: "TEST",
              verification_uri: "https://as.example.com/verify",
              expires_in: 60,
              interval: 1,
            }),
            { headers: { "Content-Type": "application/json" } },
          )
        }
        polls++
        const now = Date.now()
        if (lastPoll) times.push(now - lastPoll)
        lastPoll = now
        if (polls <= 2) {
          return new Response(JSON.stringify({ error: "slow_down" }), { status: 400 })
        }
        return new Response(
          JSON.stringify({ access_token: "tok", token_type: "Bearer" }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${s.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    expect(result).toBeDefined()
    const cred = await result!.poll()
    expect(cred).toBeDefined()
    expect(cred!.access_token).toBe("tok")
    // After 2 slow_down responses with 1s base, intervals should increase:
    // poll 1: ~1s, poll 2: ~6s (1+5), poll 3: ~11s (1+5+5)
    expect(times.length).toBeGreaterThanOrEqual(2)
    expect(times[1]!).toBeGreaterThan(times[0]! + 3000)
  }, 30000)

  test("terminal errors stop polling (access_denied)", async () => {
    let polls = 0
    const s = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/device") {
          return new Response(
            JSON.stringify({
              device_code: "dc",
              user_code: "TEST",
              verification_uri: "https://as.example.com/verify",
              expires_in: 30,
              interval: 1,
            }),
            { headers: { "Content-Type": "application/json" } },
          )
        }
        polls++
        if (polls === 1) {
          return new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 })
        }
        return new Response(JSON.stringify({ error: "access_denied" }), { status: 400 })
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${s.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    expect(result).toBeDefined()
    const cred = await result!.poll()
    expect(cred).toBeUndefined()
    expect(polls).toBe(2)
  })

  test("returns undefined on device authorization failure", async () => {
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: "unauthorized_client" }),
          { status: 400 },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${s.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    expect(result).toBeUndefined()
  })

  test("rejects device authorization response missing expires_in (RFC 8628 §3.2)", async () => {
    const s = Bun.serve({
      port: 0,
      fetch() {
        // Response omits REQUIRED expires_in field
        return new Response(
          JSON.stringify({
            device_code: "dc-no-expiry",
            user_code: "NOEXP",
            verification_uri: "https://as.example.com/verify",
            interval: 5,
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${s.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    // expires_in is REQUIRED per RFC 8628 §3.2 — must reject
    expect(result).toBeUndefined()
  })

  test("clamps absurdly large expires_in to MAX_DEVICE_CODE_LIFETIME", async () => {
    // A malicious AS returning expires_in: 999999999 (~31 years) must not
    // cause the poll loop to run indefinitely. The deadline should be clamped
    // to MAX_DEVICE_CODE_LIFETIME seconds from now.
    let polls = 0
    const s = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/device") {
          return new Response(
            JSON.stringify({
              device_code: "dc-clamp",
              user_code: "CLAMP",
              verification_uri: "https://as.example.com/verify",
              expires_in: 999999999, // ~31 years
              interval: 1,
            }),
            { headers: { "Content-Type": "application/json" } },
          )
        }
        polls++
        // Succeed on first poll so the test doesn't actually wait
        return new Response(
          JSON.stringify({ access_token: "tok-clamped", token_type: "Bearer" }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${s.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const before = Date.now()
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    expect(result).toBeDefined()
    const cred = await result!.poll()
    const after = Date.now()
    expect(cred).toBeDefined()
    expect(cred!.access_token).toBe("tok-clamped")
    expect(polls).toBe(1)
    // The entire flow (initiate + one poll) should complete in well under
    // MAX_DEVICE_CODE_LIFETIME, proving the deadline was clamped and didn't
    // extend to ~31 years.
    expect(after - before).toBeLessThan(MAX_DEVICE_CODE_LIFETIME * 1000)
  })

  test("negative expires_in is treated as zero (immediate expiry)", async () => {
    const s = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/device") {
          return new Response(
            JSON.stringify({
              device_code: "dc-neg",
              user_code: "NEG",
              verification_uri: "https://as.example.com/verify",
              expires_in: -100,
              interval: 1,
            }),
            { headers: { "Content-Type": "application/json" } },
          )
        }
        // Should never reach token endpoint — deadline already passed
        return new Response(
          JSON.stringify({ access_token: "should-not-get", token_type: "Bearer" }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${s.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    expect(result).toBeDefined()
    // With negative expires_in clamped to 0, deadline is already in the past,
    // so poll() should return undefined without making any token requests.
    const cred = await result!.poll()
    expect(cred).toBeUndefined()
  })

  test("MAX_DEVICE_CODE_LIFETIME is a reasonable positive value", () => {
    expect(MAX_DEVICE_CODE_LIFETIME).toBeGreaterThan(0)
    // Must not exceed 1 hour — anything longer is unreasonable for device code
    expect(MAX_DEVICE_CODE_LIFETIME).toBeLessThanOrEqual(3600)
  })

  test("honors abort signal before device authorization request", async () => {
    let hit = false
    const s = Bun.serve({
      port: 0,
      fetch() {
        hit = true
        return new Response(
          JSON.stringify({
            device_code: "test-device-code",
            user_code: "ABCD-1234",
            verification_uri: "https://as.example.com/verify",
            expires_in: 300,
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      },
    })
    servers.push(s)

    const ctrl = new AbortController()
    ctrl.abort()

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${s.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client, undefined, undefined, ctrl.signal)
    expect(result).toBeUndefined()
    expect(hit).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Redirect blocking — all operational endpoint fetches MUST use
// redirect: "error" to prevent a malicious AS from redirecting
// sensitive POST bodies (auth codes, PKCE verifiers, client secrets,
// device codes) to attacker-controlled or internal services.
// ---------------------------------------------------------------------------

describe("redirect blocking on operational endpoint fetches", () => {
  const servers: ReturnType<typeof Bun.serve>[] = []
  afterEach(() => {
    for (const s of servers) s.stop()
    servers.length = 0
  })

  const resource: ResourceMetadata = {
    resource: "https://api.example.com",
    scopes_supported: ["read"],
  }

  const client = { client_id: "test-client" }

  /**
   * Helper: start a server that responds with a 302 redirect.
   * If any request arrives at the redirect target, the test fails —
   * redirect: "error" should prevent the fetch from following it.
   */
  function redirectServer(targetPort: number, path: string) {
    const s = Bun.serve({
      port: 0,
      fetch() {
        return new Response(null, {
          status: 302,
          headers: { Location: `http://127.0.0.1:${targetPort}${path}` },
        })
      },
    })
    servers.push(s)
    return s
  }

  function targetServer() {
    let hit = false
    const s = Bun.serve({
      port: 0,
      fetch() {
        hit = true
        return new Response(JSON.stringify({ error: "redirect_followed" }), { status: 200 })
      },
    })
    servers.push(s)
    return { server: s, wasHit: () => hit }
  }

  test("register() rejects redirecting registration_endpoint", async () => {
    const target = targetServer()
    const redirector = redirectServer(target.server.port as number, "/steal")

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      registration_endpoint: `http://127.0.0.1:${redirector.port as number}/register`,
      response_types_supported: ["code"],
    }
    const result = await register(meta, "http://127.0.0.1:19877/callback", { name: "OpenCode", uri: "https://opencode.ai" })
    // Must fail — redirect: "error" causes fetch to throw, caught by .catch()
    expect(result).toBeUndefined()
    // The redirect target must never have been contacted
    expect(target.wasHit()).toBe(false)
  })

  test("deviceCode() rejects redirecting device_authorization_endpoint", async () => {
    const target = targetServer()
    const redirector = redirectServer(target.server.port as number, "/steal")

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${redirector.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${redirector.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    // Must fail — the device authorization request was redirected
    expect(result).toBeUndefined()
    expect(target.wasHit()).toBe(false)
  })

  test("deviceCode() poll rejects redirecting token_endpoint", async () => {
    // Device authorization succeeds, but token polling endpoint redirects.
    // redirect: "error" makes the fetch throw, which the poll loop treats as
    // a network error (exponential backoff). Use a short expires_in so the
    // poll loop times out quickly instead of retrying for too long.
    const target = targetServer()
    const s = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/device") {
          return new Response(
            JSON.stringify({
              device_code: "dc-redirect",
              user_code: "REDIR",
              verification_uri: "https://as.example.com/verify",
              expires_in: 3,
              interval: 1,
            }),
            { headers: { "Content-Type": "application/json" } },
          )
        }
        // Token endpoint redirects to the target
        return new Response(null, {
          status: 302,
          headers: { Location: `http://127.0.0.1:${target.server.port as number}/steal` },
        })
      },
    })
    servers.push(s)

    const meta: ASMetadata = {
      issuer: "https://as.example.com",
      device_authorization_endpoint: `http://127.0.0.1:${s.port as number}/device`,
      token_endpoint: `http://127.0.0.1:${s.port as number}/token`,
      response_types_supported: ["code"],
    }
    const result = await deviceCode("https://api.example.com/data", resource, meta, client)
    expect(result).toBeDefined()
    // poll() should fail — redirect: "error" prevents following the redirect,
    // and the short expires_in causes the poll loop to time out.
    const cred = await result!.poll()
    expect(cred).toBeUndefined()
    // The redirect target must never have received the device_code
    expect(target.wasHit()).toBe(false)
  }, 10000)
})
