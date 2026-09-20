import { expect } from "bun:test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { Config } from "../../src/config/config"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { McpAuth } from "../../src/mcp/auth"
import { MCP } from "../../src/mcp/index"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { McpOAuthProvider } from "../../src/mcp/oauth-provider"
import { testEffect } from "../lib/effect"

const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose"

const mcpTest = testEffect(
  LayerNode.compile(
    LayerNode.group([MCP.node, McpAuth.node, EventV2Bridge.node, Config.node, CrossSpawnSpawner.node, FSUtil.node]),
  ),
)

// Gmail-like mock: initialize handshake returns HTTP 200 without auth,
// protected methods require a Bearer token. OAuth metadata is exposed ONLY
// at the path-specific endpoint, mirroring
// /.well-known/oauth-protected-resource/mcp/v1.
function serveGmailLikeMcp() {
  return Effect.acquireRelease(
    Effect.promise(async () => {
      const seenPaths: string[] = []
      const tokenRedirectUris: Array<string | null> = []
      const protocol = new Server({ name: "gmail-like", version: "1.0.0" }, { capabilities: { tools: {} } })
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      })
      protocol.setRequestHandler(ListToolsRequestSchema, () =>
        Promise.resolve({ tools: [{ name: "gmail_read", inputSchema: { type: "object" } }] }),
      )
      await protocol.connect(transport)

      const http = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          seenPaths.push(url.pathname)
          const origin = url.origin
          const mcpUrl = `${origin}/mcp/v1`
          const resourceMetadataPath = "/.well-known/oauth-protected-resource/mcp/v1"

          if (url.pathname === resourceMetadataPath) {
            return Response.json({
              resource: mcpUrl,
              authorization_servers: [origin],
              scopes_supported: [
                "https://www.googleapis.com/auth/gmail.readonly",
                "https://www.googleapis.com/auth/gmail.compose",
              ],
            })
          }
          if (url.pathname === "/.well-known/oauth-protected-resource") {
            return new Response("Not found", { status: 404 })
          }
          if (url.pathname === "/.well-known/oauth-authorization-server") {
            return Response.json({
              issuer: origin,
              authorization_endpoint: `${origin}/authorize`,
              token_endpoint: `${origin}/token`,
              registration_endpoint: `${origin}/register`,
              response_types_supported: ["code"],
              grant_types_supported: ["authorization_code", "refresh_token"],
              token_endpoint_auth_methods_supported: ["none"],
              code_challenge_methods_supported: ["S256"],
              scopes_supported: [
                "https://www.googleapis.com/auth/gmail.readonly",
                "https://www.googleapis.com/auth/gmail.compose",
              ],
            })
          }
          if (url.pathname === "/register") {
            const metadata = (await request.json()) as Record<string, unknown>
            return Response.json({ ...metadata, client_id: "gmail-client" }, { status: 201 })
          }
          if (url.pathname === "/token") {
            const body = new URLSearchParams(await request.text())
            tokenRedirectUris.push(body.get("redirect_uri"))
            // Refresh grant: expired access tokens refresh when a refresh token exists.
            if (body.get("grant_type") === "refresh_token") {
              if (body.get("refresh_token") !== "gmail-refresh") {
                return Response.json(
                  { error: "invalid_grant", error_description: "Token refresh failed" },
                  { status: 400 },
                )
              }
              return Response.json({
                access_token: "gmail-token-refreshed",
                token_type: "Bearer",
                expires_in: 3600,
                scope: GMAIL_SCOPES,
                refresh_token: "gmail-refresh-rotated",
              })
            }
            if (body.get("code") !== "valid-code") {
              return Response.json(
                { error: "invalid_grant", error_description: "Token exchange failed" },
                { status: 400 },
              )
            }
            return Response.json({
              access_token: "gmail-token",
              token_type: "Bearer",
              expires_in: 3600,
              scope: GMAIL_SCOPES,
              refresh_token: "gmail-refresh",
            })
          }
          if (url.pathname !== "/mcp/v1") return new Response("Not found", { status: 404 })
          if (request.method === "GET") return new Response(null, { status: 405 })

          // Gmail behavior: allow the initialize handshake without auth so it
          // returns HTTP 200, but require OAuth for everything else.
          const peek = await request.clone().text()
          const isHandshake = isHandshakeRequest(peek)
          const authorization = request.headers.get("authorization")
          const hasValidToken =
            authorization === "Bearer gmail-token" || authorization === "Bearer gmail-token-refreshed"
          if (!isHandshake && !hasValidToken) {
            return new Response("Unauthorized", {
              status: 401,
              headers: {
                "WWW-Authenticate": `Bearer resource_metadata="${origin}${resourceMetadataPath}", scope="${GMAIL_SCOPES}"`,
              },
            })
          }
          return transport.handleRequest(request)
        },
      })

      return {
        url: new URL("/mcp/v1", http.url).toString(),
        seenPaths: () => seenPaths,
        seenTokenRedirectUris: () => tokenRedirectUris,
        close: async () => {
          await http.stop(true)
          await protocol.close()
        },
      }
    }),
    (server) => Effect.promise(server.close),
  )
}

const remoteWithGmailScopes = (url: string, oauth?: Record<string, unknown>) => ({
  type: "remote" as const,
  url,
  enabled: false,
  oauth: { scope: GMAIL_SCOPES, ...oauth },
})

async function getFreePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("probe") })
  const port = probe.port
  if (!port) throw new Error("failed to allocate a free port for OAuth redirect test")
  await probe.stop(true)
  return port
}

function isHandshakeRequest(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body)
    const messages = Array.isArray(parsed) ? parsed : [parsed]
    return messages.some(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        "method" in message &&
        ((message as { method?: unknown }).method === "initialize" ||
          (message as { method?: unknown }).method === "notifications/initialized"),
    )
  } catch {
    return false
  }
}

const stopOAuthCallback = Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()).pipe(Effect.ignore))

mcpTest.instance("explicit auth enters OAuth even when the handshake returns 200", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveGmailLikeMcp()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const name = "test-gmail-false-positive"

    // Prove the bug scenario: a bare handshake without OAuth succeeds (HTTP 200).
    const bare = yield* Effect.promise(async () => {
      const client = new Client({ name: "bare-handshake", version: "1.0.0" })
      const transport = new StreamableHTTPClientTransport(new URL(server.url))
      await client.connect(transport)
      await client.close()
      return true
    })
    expect(bare).toBe(true)

    yield* mcp.add(name, remoteWithGmailScopes(server.url))
    const started = yield* mcp.startAuth(name)
    expect(started.authorizationUrl).toContain("/authorize")
    // Path-specific resource metadata is used for the resource indicator.
    expect(started.authorizationUrl).toContain("resource=")
    expect(started.authorizationUrl).toContain("mcp%2Fv1")
    // Explicit Gmail scopes are requested.
    expect(started.authorizationUrl).toContain("gmail.readonly")
    expect(started.authorizationUrl).toContain("gmail.compose")
    // No tokens are persisted before the flow completes: no false success.
    expect((yield* auth.get(name))?.tokens).toBeUndefined()
    // Starting OAuth must not mark the server connected.
    // (The fixture disables auto-connect, so status stays disabled, never connected.)
    expect((yield* mcp.status())[name]?.status).not.toBe("connected")
    expect(yield* mcp.getAuthStatus(name)).toBe("not_authenticated")
    expect(server.seenPaths()).toContain("/.well-known/oauth-protected-resource/mcp/v1")
  }),
)

mcpTest.instance("failed OAuth does not report success", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveGmailLikeMcp()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const name = "test-gmail-failure"

    yield* mcp.add(name, remoteWithGmailScopes(server.url))
    const started = yield* mcp.startAuth(name)
    expect(started.authorizationUrl).toContain("/authorize")

    expect(yield* mcp.finishAuth(name, "invalid-code")).toEqual({
      status: "failed",
      error: "OAuth completion failed: Token exchange failed",
    })
    expect((yield* auth.get(name))?.tokens).toBeUndefined()
    // Failed callback must not leave a false authenticated state.
    expect((yield* mcp.status())[name]?.status).not.toBe("connected")
    expect(yield* mcp.getAuthStatus(name)).toBe("not_authenticated")
  }),
)

mcpTest.instance("successful OAuth persists tokens", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveGmailLikeMcp()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const name = "test-gmail-success"

    yield* mcp.add(name, remoteWithGmailScopes(server.url))
    const started = yield* mcp.startAuth(name)
    expect(started.authorizationUrl).toContain("/authorize")

    const finished = yield* mcp.finishAuth(name, "valid-code")
    expect(finished.status).toBe("connected")
    const entry = yield* auth.get(name)
    expect(entry?.tokens?.accessToken).toBe("gmail-token")
    // Complete token response is persisted, including refresh token when supplied.
    expect(entry?.tokens?.refreshToken).toBe("gmail-refresh")
    expect(entry?.tokens?.scope).toBe(GMAIL_SCOPES)
    expect(entry?.tokens?.expiresAt).toBeGreaterThan(Date.now() / 1000)
    expect(entry?.serverUrl).toBe(server.url)
    expect(yield* mcp.getAuthStatus(name)).toBe("authenticated")
  }),
)

mcpTest.instance("preserves exact redirect URI through OAuth flow", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveGmailLikeMcp()
    const mcp = yield* MCP.Service
    const auth = yield* McpAuth.Service
    const name = "test-gmail-redirect"

    // Mirror the real-world shape from the ticket: localhost with a custom path.
    const callbackPort = yield* Effect.promise(getFreePort)
    const redirectUri = `http://localhost:${callbackPort}/callback`

    yield* mcp.add(name, remoteWithGmailScopes(server.url, { redirectUri }))
    const started = yield* mcp.startAuth(name)
    const authorizationUrl = new URL(started.authorizationUrl)
    // The exact configured redirect URI is used for the authorization request.
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(redirectUri)

    const finished = yield* mcp.finishAuth(name, "valid-code")
    expect(finished.status).toBe("connected")
    // The callback code is exchanged with the same redirect URI.
    expect(server.seenTokenRedirectUris()).toContain(redirectUri)
    const entry = yield* auth.get(name)
    expect(entry?.tokens?.accessToken).toBe("gmail-token")
    expect(entry?.tokens?.refreshToken).toBe("gmail-refresh")
  }),
)

mcpTest.instance("expired access token refreshes when refresh token exists", () =>
  Effect.gen(function* () {
    yield* stopOAuthCallback
    const server = yield* serveGmailLikeMcp()
    const auth = yield* McpAuth.Service
    const name = "test-gmail-refresh"

    // Seed an expired access token with a usable refresh token.
    yield* auth.updateClientInfo(name, { clientId: "gmail-client" }, server.url)
    yield* auth.updateTokens(
      name,
      { accessToken: "expired-token", refreshToken: "gmail-refresh", expiresAt: Date.now() / 1000 - 100 },
      server.url,
    )

    const provider = new McpOAuthProvider(
      name,
      server.url,
      { scope: GMAIL_SCOPES },
      {
        onRedirect: async () => {
          throw new Error("refresh should not require a browser redirect")
        },
      },
      auth,
    )
    const sdkAuth = yield* Effect.promise(() => import("@modelcontextprotocol/sdk/client/auth.js"))
    const result = yield* Effect.promise(() =>
      sdkAuth.auth(provider, { serverUrl: server.url, scope: GMAIL_SCOPES }),
    )
    expect(result).toBe("AUTHORIZED")

    const entry = yield* auth.get(name)
    expect(entry?.tokens?.accessToken).toBe("gmail-token-refreshed")
    // Rotated refresh token is persisted when the server returns one.
    expect(entry?.tokens?.refreshToken).toBe("gmail-refresh-rotated")
  }),
)
