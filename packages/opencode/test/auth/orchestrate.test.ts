import { describe, test, expect, afterEach } from "bun:test"
import { handleAuthChallenge } from "../../src/auth/orchestrate"
import type { CredentialStore, Credential } from "../../src/auth/webfetch-auth"

class MemoryStore implements CredentialStore {
  #data: Record<string, Credential> = {}

  async get(resource: string) {
    return this.#data[resource]
  }

  async set(resource: string, cred: Credential) {
    this.#data[resource] = cred
  }

  async remove(resource: string) {
    delete this.#data[resource]
  }

  async all() {
    return this.#data
  }
}

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
}

describe("handleAuthChallenge()", () => {
  const servers: ReturnType<typeof Bun.serve>[] = []

  afterEach(() => {
    for (const s of servers) s.stop()
    servers.length = 0
  })

  test("throws Basic auth guidance when discovery is unavailable", async () => {
    const resource = Bun.serve({
      port: 0,
      fetch() {
        return new Response("Not found", { status: 404 })
      },
    })
    servers.push(resource)

    const url = `http://127.0.0.1:${resource.port as number}/protected`
    await expect(
      handleAuthChallenge({
        response: new Response("unauthorized", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="Members"' },
        }),
        url,
        baseHeaders: {},
        signal: new AbortController().signal,
        store: new MemoryStore(),
        interaction: {
          async askConsent() {},
          async openUrl() {},
          async showDeviceCode() {},
        },
      }),
    ).rejects.toThrow("This URL requires Basic authentication (realm: Members).")
  })

  test("returns undefined when no discovery metadata is available", async () => {
    const resource = Bun.serve({
      port: 0,
      fetch() {
        return new Response("Not found", { status: 404 })
      },
    })
    servers.push(resource)

    const url = `http://127.0.0.1:${resource.port as number}/protected`
    const result = await handleAuthChallenge({
      response: new Response("unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="OAuth"' },
      }),
      url,
      baseHeaders: {},
      signal: new AbortController().signal,
      store: new MemoryStore(),
      interaction: {
        async askConsent() {},
        async openUrl() {},
        async showDeviceCode() {},
      },
    })

    expect(result).toBeUndefined()
  })

  test("reports missing client configuration when registration is unavailable", async () => {
    let resource: ReturnType<typeof Bun.serve>
    let auth: ReturnType<typeof Bun.serve>

    auth = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/.well-known/oauth-authorization-server") {
          return json({
            issuer: `http://127.0.0.1:${auth.port as number}`,
            authorization_endpoint: `http://127.0.0.1:${auth.port as number}/authorize`,
            token_endpoint: `http://127.0.0.1:${auth.port as number}/token`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code"],
          })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    resource = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        const base = `http://127.0.0.1:${resource.port as number}`
        if (url.pathname === "/.well-known/oauth-protected-resource/protected") {
          return json({
            resource: `${base}/protected`,
            authorization_servers: [`http://127.0.0.1:${auth.port as number}`],
          })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    servers.push(auth, resource)

    const url = `http://127.0.0.1:${resource.port as number}/protected`
    await expect(
      handleAuthChallenge({
        response: new Response("unauthorized", {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer resource_metadata="http://127.0.0.1:${resource.port as number}/.well-known/oauth-protected-resource/protected"`,
          },
        }),
        url,
        baseHeaders: {},
        signal: new AbortController().signal,
        store: new MemoryStore(),
        interaction: {
          async askConsent() {},
          async openUrl() {},
          async showDeviceCode() {},
        },
      }),
    ).rejects.toThrow(`This URL requires OAuth authentication via http://127.0.0.1:${auth.port as number}, but no client_id is configured and dynamic registration is not available.`)
  })

  test("tries later discovered authorization servers when the first one fails", async () => {
    let resource: ReturnType<typeof Bun.serve>
    let first: ReturnType<typeof Bun.serve>
    let second: ReturnType<typeof Bun.serve>
    let firstTokens = 0
    let secondTokens = 0

    first = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/.well-known/oauth-authorization-server") {
          return json({
            issuer: `http://127.0.0.1:${first.port as number}`,
            authorization_endpoint: `http://127.0.0.1:${first.port as number}/authorize`,
            token_endpoint: `http://127.0.0.1:${first.port as number}/token`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code"],
          })
        }
        if (url.pathname === "/token") {
          firstTokens++
          return json({ error: "invalid_grant" }, { status: 400 })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    second = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/.well-known/oauth-authorization-server") {
          return json({
            issuer: `http://127.0.0.1:${second.port as number}`,
            authorization_endpoint: `http://127.0.0.1:${second.port as number}/authorize`,
            token_endpoint: `http://127.0.0.1:${second.port as number}/token`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code"],
          })
        }
        if (url.pathname === "/token") {
          secondTokens++
          return json({ access_token: "second-token", token_type: "Bearer" })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    resource = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        const base = `http://127.0.0.1:${resource.port as number}`
        if (url.pathname === "/.well-known/oauth-protected-resource/protected") {
          return json({
            resource: `${base}/protected`,
            authorization_servers: [
              `http://127.0.0.1:${first.port as number}`,
              `http://127.0.0.1:${second.port as number}`,
            ],
          })
        }
        if (url.pathname === "/protected") {
          if (req.headers.get("authorization") === "Bearer second-token") {
            return new Response("ok")
          }
          return new Response("unauthorized", { status: 401 })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    servers.push(first, second, resource)

    const url = `http://127.0.0.1:${resource.port as number}/protected`
    const response = new Response("unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="http://127.0.0.1:${resource.port as number}/.well-known/oauth-protected-resource/protected"`,
      },
    })

    const result = await handleAuthChallenge({
      response,
      url,
      baseHeaders: {},
      signal: new AbortController().signal,
      store: new MemoryStore(),
      interaction: {
        async askConsent() {},
        async openUrl() {},
        async showDeviceCode() {},
      },
      callbackServer: {
        async start() {
          return { redirectUri: "http://127.0.0.1:19877/oauth/callback" }
        },
        async waitForCode() {
          return "test-code"
        },
        async stop() {},
      },
      client: { name: "OpenCode", clientId: "test-client" },
    })

    expect(result).toBeDefined()
    expect(await result!.text()).toBe("ok")
    expect(firstTokens).toBe(1)
    expect(secondTokens).toBe(1)
  })

  test("does not misreport missing client_id when dynamic registration exists", async () => {
    let resource: ReturnType<typeof Bun.serve>
    let auth: ReturnType<typeof Bun.serve>

    auth = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/.well-known/oauth-authorization-server") {
          return json({
            issuer: `http://127.0.0.1:${auth.port as number}`,
            authorization_endpoint: `http://127.0.0.1:${auth.port as number}/authorize`,
            token_endpoint: `http://127.0.0.1:${auth.port as number}/token`,
            registration_endpoint: `http://127.0.0.1:${auth.port as number}/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code"],
          })
        }
        if (url.pathname === "/register") {
          return json({ client_id: "registered-client" })
        }
        if (url.pathname === "/token") {
          return json({ error: "invalid_grant" }, { status: 400 })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    resource = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        const base = `http://127.0.0.1:${resource.port as number}`
        if (url.pathname === "/.well-known/oauth-protected-resource/protected") {
          return json({
            resource: `${base}/protected`,
            authorization_servers: [`http://127.0.0.1:${auth.port as number}`],
          })
        }
        if (url.pathname === "/protected") {
          return new Response("unauthorized", { status: 401 })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    servers.push(auth, resource)

    const url = `http://127.0.0.1:${resource.port as number}/protected`
    const response = new Response("unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="http://127.0.0.1:${resource.port as number}/.well-known/oauth-protected-resource/protected"`,
      },
    })

    await expect(
      handleAuthChallenge({
        response,
        url,
        baseHeaders: {},
        signal: new AbortController().signal,
        store: new MemoryStore(),
        interaction: {
          async askConsent() {},
          async openUrl() {},
          async showDeviceCode() {},
        },
        callbackServer: {
          async start() {
            return { redirectUri: "http://127.0.0.1:19877/oauth/callback" }
          },
          async waitForCode() {
            return "test-code"
          },
          async stop() {},
        },
      }),
    ).rejects.toThrow(`OAuth authentication failed for ${url} via http://127.0.0.1:${auth.port as number}. Please try again.`)
  })

  test("reuses stored client when issuer matches", async () => {
    let resource: ReturnType<typeof Bun.serve>
    let auth: ReturnType<typeof Bun.serve>
    const store = new MemoryStore()
    let tokenHits = 0

    auth = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/.well-known/oauth-authorization-server") {
          return json({
            issuer: `http://127.0.0.1:${auth.port as number}`,
            authorization_endpoint: `http://127.0.0.1:${auth.port as number}/authorize`,
            token_endpoint: `http://127.0.0.1:${auth.port as number}/token`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code"],
          })
        }
        if (url.pathname === "/token") {
          tokenHits++
          expect(req.headers.get("authorization")).toBe(`Basic ${Buffer.from("stored-client:stored-secret", "utf-8").toString("base64")}`)
          const body = new URLSearchParams(await req.text())
          expect(body.get("client_id")).toBeNull()
          expect(body.get("client_secret")).toBeNull()
          return json({ access_token: "fresh-token", token_type: "Bearer" })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    resource = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        const base = `http://127.0.0.1:${resource.port as number}`
        if (url.pathname === "/.well-known/oauth-protected-resource/protected") {
          return json({
            resource: `${base}/protected`,
            authorization_servers: [`http://127.0.0.1:${auth.port as number}`],
          })
        }
        if (url.pathname === "/protected") {
          if (req.headers.get("authorization") === "Bearer fresh-token") return new Response("ok")
          return new Response("unauthorized", { status: 401 })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    servers.push(auth, resource)

    const url = `http://127.0.0.1:${resource.port as number}/protected`
    await store.set(url, {
      resource: url,
      scheme: "bearer",
      oauth_client_id: "stored-client",
      oauth_client_secret: "stored-secret",
      issuer: `http://127.0.0.1:${auth.port as number}`,
    })

    const result = await handleAuthChallenge({
      response: new Response("unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="http://127.0.0.1:${resource.port as number}/.well-known/oauth-protected-resource/protected"`,
        },
      }),
      url,
      baseHeaders: {},
      signal: new AbortController().signal,
      store,
      interaction: {
        async askConsent() {},
        async openUrl() {},
        async showDeviceCode() {},
      },
      callbackServer: {
        async start() {
          return { redirectUri: "http://127.0.0.1:19877/oauth/callback" }
        },
        async waitForCode() {
          return "test-code"
        },
        async stop() {},
      },
    })

    expect(tokenHits).toBe(1)
    expect(result).toBeDefined()
    expect(await result!.text()).toBe("ok")
  })

  test("runs device code flow when authorization code is unavailable", async () => {
    let resource: ReturnType<typeof Bun.serve>
    let auth: ReturnType<typeof Bun.serve>
    let deviceShown: { verification_uri: string; user_code: string } | undefined
    let polls = 0

    auth = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/.well-known/oauth-authorization-server") {
          return json({
            issuer: `http://127.0.0.1:${auth.port as number}`,
            token_endpoint: `http://127.0.0.1:${auth.port as number}/token`,
            device_authorization_endpoint: `http://127.0.0.1:${auth.port as number}/device`,
            response_types_supported: ["code"],
            grant_types_supported: ["urn:ietf:params:oauth:grant-type:device_code"],
          })
        }
        if (url.pathname === "/device") {
          return json({
            device_code: "device-code",
            user_code: "ABCD-1234",
            verification_uri: "https://as.example.com/verify",
            expires_in: 60,
            interval: 0,
          })
        }
        if (url.pathname === "/token") {
          polls++
          return json({ access_token: "device-token", token_type: "Bearer" })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    resource = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        const base = `http://127.0.0.1:${resource.port as number}`
        if (url.pathname === "/.well-known/oauth-protected-resource/protected") {
          return json({
            resource: `${base}/protected`,
            authorization_servers: [`http://127.0.0.1:${auth.port as number}`],
          })
        }
        if (url.pathname === "/protected") {
          if (req.headers.get("authorization") === "Bearer device-token") return new Response("ok")
          return new Response("unauthorized", { status: 401 })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    servers.push(auth, resource)

    const url = `http://127.0.0.1:${resource.port as number}/protected`
    const result = await handleAuthChallenge({
      response: new Response("unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="http://127.0.0.1:${resource.port as number}/.well-known/oauth-protected-resource/protected"`,
        },
      }),
      url,
      baseHeaders: {},
      signal: new AbortController().signal,
      store: new MemoryStore(),
      interaction: {
        async askConsent() {},
        async openUrl() {
          throw new Error("should not open browser")
        },
        async showDeviceCode(info) {
          deviceShown = info
        },
      },
      client: { name: "OpenCode", clientId: "device-client" },
    })

    expect(result).toBeDefined()
    expect(await result!.text()).toBe("ok")
    expect(deviceShown).toEqual({ verification_uri: "https://as.example.com/verify", user_code: "ABCD-1234" })
    expect(polls).toBe(1)
  })

  test("removes stored credential when authenticated retry still fails", async () => {
    let resource: ReturnType<typeof Bun.serve>
    let auth: ReturnType<typeof Bun.serve>
    const store = new MemoryStore()

    auth = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/.well-known/oauth-authorization-server") {
          return json({
            issuer: `http://127.0.0.1:${auth.port as number}`,
            authorization_endpoint: `http://127.0.0.1:${auth.port as number}/authorize`,
            token_endpoint: `http://127.0.0.1:${auth.port as number}/token`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code"],
          })
        }
        if (url.pathname === "/token") {
          return json({ access_token: "bad-token", token_type: "Bearer" })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    resource = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        const base = `http://127.0.0.1:${resource.port as number}`
        if (url.pathname === "/.well-known/oauth-protected-resource/protected") {
          return json({
            resource: `${base}/protected`,
            authorization_servers: [`http://127.0.0.1:${auth.port as number}`],
          })
        }
        if (url.pathname === "/protected") {
          return new Response("still unauthorized", { status: 401 })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    servers.push(auth, resource)

    const url = `http://127.0.0.1:${resource.port as number}/protected`
    await expect(
      handleAuthChallenge({
        response: new Response("unauthorized", {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer resource_metadata="http://127.0.0.1:${resource.port as number}/.well-known/oauth-protected-resource/protected"`,
          },
        }),
        url,
        baseHeaders: {},
        signal: new AbortController().signal,
        store,
        interaction: {
          async askConsent() {},
          async openUrl() {},
          async showDeviceCode() {},
        },
        callbackServer: {
          async start() {
            return { redirectUri: "http://127.0.0.1:19877/oauth/callback" }
          },
          async waitForCode() {
            return "test-code"
          },
          async stop() {},
        },
        client: { name: "OpenCode", clientId: "test-client" },
      }),
    ).rejects.toThrow(`OAuth authentication succeeded but retry failed for ${url} via http://127.0.0.1:${auth.port as number}.`)

    expect(await store.all()).toEqual({})
  })

  test("surfaces browser launch failures from the orchestrator", async () => {
    let resource: ReturnType<typeof Bun.serve>
    let auth: ReturnType<typeof Bun.serve>
    let stopCalled = 0

    auth = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/.well-known/oauth-authorization-server") {
          return json({
            issuer: `http://127.0.0.1:${auth.port as number}`,
            authorization_endpoint: `http://127.0.0.1:${auth.port as number}/authorize`,
            token_endpoint: `http://127.0.0.1:${auth.port as number}/token`,
            registration_endpoint: `http://127.0.0.1:${auth.port as number}/register`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code"],
          })
        }
        if (url.pathname === "/register") return json({ client_id: "registered-client" })
        return new Response("Not found", { status: 404 })
      },
    })
    resource = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        const base = `http://127.0.0.1:${resource.port as number}`
        if (url.pathname === "/.well-known/oauth-protected-resource/protected") {
          return json({
            resource: `${base}/protected`,
            authorization_servers: [`http://127.0.0.1:${auth.port as number}`],
          })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    servers.push(auth, resource)

    const url = `http://127.0.0.1:${resource.port as number}/protected`
    await expect(
      handleAuthChallenge({
        response: new Response("unauthorized", {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer resource_metadata="http://127.0.0.1:${resource.port as number}/.well-known/oauth-protected-resource/protected"`,
          },
        }),
        url,
        baseHeaders: {},
        signal: new AbortController().signal,
        store: new MemoryStore(),
        interaction: {
          async askConsent() {},
          async openUrl() {
            throw new Error("cannot open browser")
          },
          async showDeviceCode() {},
        },
        callbackServer: {
          async start() {
            return { redirectUri: "http://127.0.0.1:19877/oauth/callback" }
          },
          async waitForCode() {
            return "test-code"
          },
          async stop() {
            stopCalled++
          },
        },
      }),
    ).rejects.toThrow("cannot open browser")

    expect(stopCalled).toBe(1)
  })

  test("falls back to device code when opening the browser fails", async () => {
    let resource: ReturnType<typeof Bun.serve>
    let auth: ReturnType<typeof Bun.serve>
    let stopCalled = 0
    let shown: { verification_uri: string; user_code: string } | undefined

    auth = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/.well-known/oauth-authorization-server") {
          return json({
            issuer: `http://127.0.0.1:${auth.port as number}`,
            authorization_endpoint: `http://127.0.0.1:${auth.port as number}/authorize`,
            token_endpoint: `http://127.0.0.1:${auth.port as number}/token`,
            device_authorization_endpoint: `http://127.0.0.1:${auth.port as number}/device`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "urn:ietf:params:oauth:grant-type:device_code"],
          })
        }
        if (url.pathname === "/device") {
          return json({
            device_code: "device-code",
            user_code: "ABCD-1234",
            verification_uri: "https://as.example.com/verify",
            expires_in: 60,
            interval: 0,
          })
        }
        if (url.pathname === "/token") {
          return json({ access_token: "device-token", token_type: "Bearer" })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    resource = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        const base = `http://127.0.0.1:${resource.port as number}`
        if (url.pathname === "/.well-known/oauth-protected-resource/protected") {
          return json({
            resource: `${base}/protected`,
            authorization_servers: [`http://127.0.0.1:${auth.port as number}`],
          })
        }
        if (url.pathname === "/protected") {
          if (req.headers.get("authorization") === "Bearer device-token") return new Response("ok")
          return new Response("unauthorized", { status: 401 })
        }
        return new Response("Not found", { status: 404 })
      },
    })
    servers.push(auth, resource)

    const url = `http://127.0.0.1:${resource.port as number}/protected`
    const result = await handleAuthChallenge({
      response: new Response("unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="http://127.0.0.1:${resource.port as number}/.well-known/oauth-protected-resource/protected"`,
        },
      }),
      url,
      baseHeaders: {},
      signal: new AbortController().signal,
      store: new MemoryStore(),
      interaction: {
        async askConsent() {},
        async openUrl() {
          throw new Error("cannot open browser")
        },
        async showDeviceCode(info) {
          shown = info
        },
      },
      callbackServer: {
        async start() {
          return { redirectUri: "http://127.0.0.1:19877/oauth/callback" }
        },
        async waitForCode() {
          return "test-code"
        },
        async stop() {
          stopCalled++
        },
      },
      client: { name: "OpenCode", clientId: "device-client" },
    })

    expect(result).toBeDefined()
    expect(await result!.text()).toBe("ok")
    expect(shown).toEqual({ verification_uri: "https://as.example.com/verify", user_code: "ABCD-1234" })
    expect(stopCalled).toBe(1)
  })
})
