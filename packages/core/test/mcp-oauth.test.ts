import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { auth } from "@modelcontextprotocol/client"
import { createMcpHandler, Server } from "@modelcontextprotocol/server"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { Form } from "@opencode/core/form"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { McpClient } from "@opencode/core/mcp/client"
import { McpOAuth } from "@opencode/core/mcp/oauth"
import { AbsolutePath } from "@opencode/core/schema"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Cause, Context, Effect, Exit, Fiber, Layer, Schedule } from "effect"
import { hostEnvironmentLayer } from "./fixture/environment"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const authServer = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) })
afterAll(() => authServer.stop(true))

const integrationID = Integration.ID.make("mcp_test")
const methodID = Integration.MethodID.make("oauth")

const remote = (url: string) => new ConfigMCP.Remote({ type: "remote", url, oauth: { client_id: "client" } })

const credential = (input: { access: string; refresh: string; expires?: number; url: string }) =>
  new Credential.Info({
    id: Credential.ID.make("cred_test"),
    integrationID,
    label: "test",
    value: {
      type: "oauth",
      methodID,
      access: input.access,
      refresh: input.refresh,
      expires: input.expires ?? Date.now() - 1000,
      metadata: { serverUrl: input.url, tokenType: "Bearer" },
    },
  })

// Connect-time providers read and write the credential store; this one lives in memory so tests can
// inspect the row the provider leaves behind.
const memoryCredentials = (initial: Credential.Info[]) => {
  const rows = new Map(initial.map((row) => [row.id, row]))
  const unused = () => Effect.die("unused credential method")
  const service = Credential.Service.of({
    lock: (_id, operation) => operation,
    all: unused,
    create: unused,
    activate: unused,
    list: (id) => Effect.sync(() => Array.from(rows.values()).filter((row) => row.integrationID === id)),
    get: (id) => Effect.sync(() => rows.get(id)),
    update: (id, updates) =>
      Effect.sync(() => {
        const row = rows.get(id)
        if (row) rows.set(id, new Credential.Info({ ...row, ...updates }))
      }),
    remove: (id) => Effect.sync(() => void rows.delete(id)),
  })
  return { rows, service }
}

const connectProvider = (config: typeof ConfigMCP.Remote.Type, store: ReturnType<typeof memoryCredentials>) =>
  Effect.runPromise(
    McpOAuth.connectProvider({ config, integrationID }).pipe(Effect.provideService(Credential.Service, store.service)),
  )

// Serves authorization server metadata with the given capabilities and records DCR + token requests.
const authorizationServer = (metadata: Record<string, unknown>) => {
  const registrations: unknown[] = []
  const tokenRequests: URLSearchParams[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/.well-known/oauth-authorization-server")
        return Response.json({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          registration_endpoint: `${url.origin}/register`,
          response_types_supported: ["code"],
          ...metadata,
        })
      if (request.method === "POST" && url.pathname === "/register") {
        registrations.push(await request.json())
        return Response.json({ client_id: "registered", redirect_uris: [] })
      }
      if (request.method === "POST" && url.pathname === "/token") {
        tokenRequests.push(new URLSearchParams(await request.text()))
        return Response.json({ access_token: "access", token_type: "Bearer" })
      }
      return new Response(null, { status: 404 })
    },
  })
  return { server, registrations, tokenRequests }
}

const start = (
  target: string | ReturnType<typeof Bun.serve>,
  oauth?: ConfigMCP.OAuth,
  store: ReturnType<typeof memoryCredentials> = memoryCredentials([]),
) =>
  Effect.gen(function* () {
    const authorization = yield* McpOAuth.authorize({
      name: "test",
      config: new ConfigMCP.Remote({
        type: "remote",
        url: typeof target === "string" ? target : target.url.href,
        ...(oauth ? { oauth } : {}),
      }),
      integrationID,
      methodID,
    })
    return { authorization, url: new URL(authorization.url) }
  }).pipe(Effect.provideService(Credential.Service, store.service))

const authorize = (redirect_uri?: string) =>
  Effect.runPromise(
    Effect.scoped(
      start(authServer, { client_id: "client", ...(redirect_uri ? { redirect_uri } : {}) }).pipe(
        Effect.map(({ url }) => url.searchParams.get("redirect_uri")),
      ),
    ),
  )

describe("MCP OAuth", () => {
  test("completes interactive authorization through the loopback callback", async () => {
    const tokenRequests: URLSearchParams[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (request.method !== "POST" || url.pathname !== "/token") return new Response(null, { status: 404 })
        tokenRequests.push(new URLSearchParams(await request.text()))
        return Response.json({
          access_token: "access",
          token_type: "Bearer",
          refresh_token: "refresh",
          expires_in: 3600,
        })
      },
    })

    const credential = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { authorization, url: authorizationUrl } = yield* start(server, { client_id: "client" })
          const redirectValue = authorizationUrl.searchParams.get("redirect_uri")
          const state = authorizationUrl.searchParams.get("state")
          if (!redirectValue || !state) throw new Error("Missing OAuth redirect parameters")
          const redirect = new URL(redirectValue)
          redirect.searchParams.set("code", "accepted")
          redirect.searchParams.set("state", state)
          expect((yield* Effect.promise(() => fetch(redirect))).status).toBe(200)
          expect((yield* Effect.promise(() => fetch(redirect))).status).toBe(409)
          return yield* authorization.callback
        }),
      ),
    ).finally(() => server.stop(true))

    expect(credential.access).toBe("access")
    expect(credential.refresh).toBe("refresh")
    expect(tokenRequests).toHaveLength(1)
    expect(tokenRequests[0]?.get("grant_type")).toBe("authorization_code")
    expect(tokenRequests[0]?.get("code")).toBe("accepted")
    expect(tokenRequests[0]?.get("code_verifier")).not.toBeNull()
    expect(tokenRequests[0]?.get("resource")).toBe(server.url.href)
  })

  test("keeps waiting for the redirect after callback requests without OAuth parameters", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        if (request.method !== "POST" || new URL(request.url).pathname !== "/token")
          return new Response(null, { status: 404 })
        return Response.json({ access_token: "access", token_type: "Bearer", refresh_token: "refresh", expires_in: 3600 })
      },
    })

    const credential = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { authorization, url: authorizationUrl } = yield* start(server, { client_id: "client" })
          const redirectValue = authorizationUrl.searchParams.get("redirect_uri")
          const state = authorizationUrl.searchParams.get("state")
          if (!redirectValue || !state) throw new Error("Missing OAuth redirect parameters")
          const callback = new URL(redirectValue)
          expect((yield* Effect.promise(() => fetch(callback, { method: "OPTIONS" }))).status).toBe(400)
          expect((yield* Effect.promise(() => fetch(callback))).status).toBe(400)
          callback.searchParams.set("code", "accepted")
          callback.searchParams.set("state", state)
          expect((yield* Effect.promise(() => fetch(callback))).status).toBe(200)
          return yield* authorization.callback
        }),
      ),
    ).finally(() => server.stop(true))

    expect(credential.access).toBe("access")
  })

  test("reports a rejected token exchange on the callback page", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (request.method !== "POST" || new URL(request.url).pathname !== "/token")
          return new Response(null, { status: 404 })
        return Response.json(
          { error: "invalid_client", error_description: "bad_client_secret" },
          { status: 400 },
        )
      },
    })

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { authorization, url: authorizationUrl } = yield* start(server, { client_id: "client" })
          const redirect = new URL(authorizationUrl.searchParams.get("redirect_uri") ?? "")
          redirect.searchParams.set("code", "accepted")
          redirect.searchParams.set("state", authorizationUrl.searchParams.get("state") ?? "")
          const response = yield* Effect.promise(() => fetch(redirect))
          const page = yield* Effect.promise(() => response.text())
          const exit = yield* Effect.exit(authorization.callback)
          return { status: response.status, page, exit }
        }),
      ),
    ).finally(() => server.stop(true))

    expect(result.status).toBe(400)
    expect(result.page).toContain("Authorization failed")
    expect(result.page).toContain("bad_client_secret")
    expect(result.exit._tag).toBe("Failure")
  })

  test("refreshes tokens loaded from a persisted credential", async () => {
    const tokenRequests: URLSearchParams[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (request.method !== "POST" || url.pathname !== "/token") return new Response(null, { status: 404 })
        tokenRequests.push(new URLSearchParams(await request.text()))
        return Response.json({ access_token: "next", token_type: "Bearer" })
      },
    })
    const store = memoryCredentials([credential({ access: "expired", refresh: "refresh", url: server.url.href })])
    const oauthProvider = await connectProvider(remote(server.url.href), store)

    const result = await auth(oauthProvider, { serverUrl: server.url.href, fetchFn: oauthProvider.send }).finally(() =>
      server.stop(true),
    )

    expect(result).toBe("AUTHORIZED")
    expect(tokenRequests).toHaveLength(1)
    expect(tokenRequests[0]?.get("grant_type")).toBe("refresh_token")
    expect(tokenRequests[0]?.get("refresh_token")).toBe("refresh")
    // The refreshed tokens land on the same credential row, stamped with the issuer they were minted by.
    const stored = store.rows.get(Credential.ID.make("cred_test"))?.value
    expect(stored?.type === "oauth" && stored.access).toBe("next")
    expect(stored?.type === "oauth" && stored.metadata?.issuer).toBe(server.url.href)
  })

  test("drops a rejected client but keeps the tokens", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname !== "/token") return new Response(null, { status: 404 })
        return Response.json({ error: "invalid_client" }, { status: 401 })
      },
    })
    // The rejection is remembered per credential and refresh token for the life of the process.
    const refresh = crypto.randomUUID()
    const saved = credential({ access: "expired", refresh, url: server.url.href })
    const store = memoryCredentials([
      new Credential.Info({ ...saved, value: { ...saved.value, metadata: { client: { client_id: "registered" } } } }),
    ])
    const config = new ConfigMCP.Remote({ type: "remote", url: server.url.href })
    const oauthProvider = await connectProvider(config, store)

    // Without the client, the SDK's retry asks for a login instead of presenting it again.
    await expect(
      auth(oauthProvider, { serverUrl: server.url.href, fetchFn: oauthProvider.send }).finally(() => server.stop(true)),
    ).rejects.toThrow("requires a login before it can register a client")
    const stored = store.rows.get(saved.id)?.value
    expect(stored?.type === "oauth" && [stored.access, stored.refresh]).toEqual(["expired", refresh])
    expect(stored?.type === "oauth" && stored.metadata?.client).toBeUndefined()
  })

  test("reports needs_auth for an unauthorized server without registering a client", async () => {
    let registrations = 0
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (request.method === "POST" && url.pathname === "/register") registrations++
        if (url.pathname === "/mcp") return new Response(null, { status: 401 })
        return new Response(null, { status: 404 })
      },
    })
    const config = new ConfigMCP.Remote({ type: "remote", url: `${server.url.origin}/mcp` })
    const oauthProvider = await connectProvider(config, memoryCredentials([]))

    const exit = await Effect.runPromise(
      Effect.scoped(McpClient.connect("test", config, import.meta.dir, oauthProvider)).pipe(
        Effect.provide(hostEnvironmentLayer),
        Effect.exit,
      ),
    ).finally(() => server.stop(true))

    const error = Exit.isFailure(exit) && Cause.squash(exit.cause)
    expect(error).toBeInstanceOf(McpClient.NeedsAuthError)
    expect(error instanceof McpClient.NeedsAuthError && error.message).toBe(
      `MCP server "${config.url}" requires a login before it can register a client`,
    )
    expect(registrations).toBe(0)
  })

  test("generates a loopback redirect URL when none is configured", async () => {
    expect(await authorize()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
  })

  test("preserves a configured redirect URL and fixed port", async () => {
    const reservation = Bun.serve({ port: 0, fetch: () => new Response() })
    const redirect = `http://127.0.0.1:${reservation.port}/fixed-callback`
    reservation.stop(true)

    expect(await authorize(redirect)).toBe(redirect)
  })

  test("rejects an invalid redirect URL", async () => {
    await expect(authorize("not a URL")).rejects.toThrow(TypeError)
  })

  test("rejects an authorization endpoint that is not http or https", async () => {
    const { server } = authorizationServer({ authorization_endpoint: "file:///tmp/authorize" })

    await expect(Effect.runPromise(Effect.scoped(start(server))).finally(() => server.stop(true))).rejects.toThrow(
      "returned a file: authorization URL",
    )
  })

  test("sends the configured URL as the resource when the server publishes no metadata", async () => {
    const { server, tokenRequests } = authorizationServer({})
    const url = `${server.url.origin}/mcp`
    const oauthProvider = await connectProvider(
      remote(url),
      memoryCredentials([credential({ access: "expired", refresh: "refresh", url })]),
    )

    await auth(oauthProvider, { serverUrl: url }).finally(() => server.stop(true))

    expect(tokenRequests[0]?.get("resource")).toBe(url)
  })

  test("discovers resource metadata without the query the transport dialed", async () => {
    const probes: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        probes.push(new URL(request.url).pathname + new URL(request.url).search)
        return new Response(null, { status: 404 })
      },
    })
    const url = `${server.url.origin}/mcp`
    const oauthProvider = await connectProvider(remote(url), memoryCredentials([]))

    await auth(oauthProvider, { serverUrl: `${url}?codemode=false` })
      .catch(() => undefined)
      .finally(() => server.stop(true))

    expect(probes).toContain("/.well-known/oauth-protected-resource/mcp")
    expect(probes.some((probe) => probe.includes("codemode"))).toBe(false)
  })

  test("keeps the configured URL as the resource when metadata echoes the dialed query", async () => {
    const tokenRequests: URLSearchParams[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/.well-known/oauth-authorization-server")
          return Response.json({
            issuer: url.origin,
            authorization_endpoint: `${url.origin}/authorize`,
            token_endpoint: `${url.origin}/token`,
            response_types_supported: ["code"],
          })
        if (url.pathname === "/.well-known/oauth-protected-resource/mcp")
          return Response.json({ resource: `${url.origin}/mcp${url.search}`, authorization_servers: [url.origin] })
        if (request.method === "POST" && url.pathname === "/token") {
          tokenRequests.push(new URLSearchParams(await request.text()))
          return Response.json({ access_token: "next", token_type: "Bearer" })
        }
        return new Response(null, { status: 404 })
      },
    })
    const url = `${server.url.origin}/mcp`
    const oauthProvider = await connectProvider(
      remote(url),
      memoryCredentials([credential({ access: "expired", refresh: "refresh", url })]),
    )

    // The transport dials with ?codemode=false and follows the 401 challenge to metadata that echoes it.
    await auth(oauthProvider, {
      serverUrl: `${url}?codemode=false`,
      resourceMetadataUrl: new URL(`${server.url.origin}/.well-known/oauth-protected-resource/mcp?codemode=false`),
    }).finally(() => server.stop(true))

    expect(tokenRequests[0]?.get("grant_type")).toBe("refresh_token")
    expect(tokenRequests[0]?.get("resource")).toBe(url)
  })

  test("finds resource metadata through the 401 header when the well-known path is not served", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/mcp")
          return new Response(null, {
            status: 401,
            headers: { "WWW-Authenticate": `Bearer resource_metadata="${url.origin}/custom/metadata"` },
          })
        if (url.pathname === "/custom/metadata")
          return Response.json({ resource: `${url.origin}/mcp`, authorization_servers: [`${url.origin}/as`] })
        if (url.pathname === "/.well-known/oauth-authorization-server/as")
          return Response.json({
            issuer: `${url.origin}/as`,
            authorization_endpoint: `${url.origin}/as/authorize`,
            token_endpoint: `${url.origin}/as/token`,
            response_types_supported: ["code"],
          })
        return new Response(null, { status: 404 })
      },
    })
    const { url } = await Effect.runPromise(
      Effect.scoped(start(`${server.url.origin}/mcp`, { client_id: "client" })),
    ).finally(() => server.stop(true))
    expect(url.pathname).toBe("/as/authorize")
  })

  test("uses configured authorization server metadata when the resource publishes none", async () => {
    const { server: issuer } = authorizationServer({})
    const resource = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) })
    const url = `${resource.url.origin}/mcp`
    const oauth = {
      client_id: "client",
      auth_server_metadata_url: `${issuer.url.origin}/.well-known/oauth-authorization-server`,
    }

    const { url: authorization } = await Effect.runPromise(Effect.scoped(start(url, oauth)))
    expect(authorization.origin).toBe(issuer.url.origin)
    expect(authorization.pathname).toBe("/authorize")
    expect(authorization.searchParams.get("resource")).toBe(url)

    const { server, tokenRequests } = authorizationServer({})
    const store = memoryCredentials([credential({ access: "expired", refresh: "refresh", url })])
    const oauthProvider = await connectProvider(
      new ConfigMCP.Remote({
        type: "remote",
        url,
        oauth: { ...oauth, auth_server_metadata_url: `${server.url.origin}/.well-known/oauth-authorization-server` },
      }),
      store,
    )
    await auth(oauthProvider, { serverUrl: url }).finally(() => {
      resource.stop(true)
      issuer.stop(true)
      server.stop(true)
    })
    expect(tokenRequests[0]?.get("grant_type")).toBe("refresh_token")
  })

  test("requests offline_access without forcing a consent prompt", async () => {
    const { server } = authorizationServer({ scopes_supported: ["read", "offline_access"] })
    const { url } = await Effect.runPromise(
      Effect.scoped(start(server, { client_id: "client", scope: "read" })),
    ).finally(() => server.stop(true))
    expect(url.searchParams.get("scope")).toBe("read offline_access")
    expect(url.searchParams.has("prompt")).toBe(false)
  })

  test("forwards iss from the redirect so issuer-advertising servers can complete", async () => {
    const { server } = authorizationServer({ authorization_response_iss_parameter_supported: true })
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { authorization, url } = yield* start(server)
          const redirect = new URL(url.searchParams.get("redirect_uri")!)
          redirect.searchParams.set("code", "accepted")
          redirect.searchParams.set("state", url.searchParams.get("state")!)
          redirect.searchParams.set("iss", server.url.origin)
          yield* Effect.promise(() => fetch(redirect))
          return yield* authorization.callback
        }),
      ),
    ).finally(() => server.stop(true))
    expect(result.access).toBe("access")
  })

  describe("client registration", () => {
    const cimd = { client_id_metadata_document_supported: true, token_endpoint_auth_methods_supported: ["none"] }

    test("uses the client metadata document when the server supports public CIMD clients", async () => {
      const { server, registrations, tokenRequests } = authorizationServer(cimd)
      const credential = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { authorization, url } = yield* start(server)
            expect(url.searchParams.get("client_id")).toBe(McpOAuth.CLIENT_METADATA_URL)
            const redirect = new URL(url.searchParams.get("redirect_uri")!)
            redirect.searchParams.set("code", "accepted")
            redirect.searchParams.set("state", url.searchParams.get("state")!)
            yield* Effect.promise(() => fetch(redirect))
            return yield* authorization.callback
          }),
        ),
      ).finally(() => server.stop(true))

      expect(registrations).toHaveLength(0)
      expect(tokenRequests[0]?.get("client_id")).toBe(McpOAuth.CLIENT_METADATA_URL)
      expect(McpOAuth.clientFromCredential(credential)).toEqual({
        client_id: McpOAuth.CLIENT_METADATA_URL,
        issuer: server.url.origin,
      })
    })

    test("registers dynamically when the server does not accept public clients", async () => {
      const { server, registrations } = authorizationServer({
        client_id_metadata_document_supported: true,
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      })
      const { url } = await Effect.runPromise(Effect.scoped(start(server))).finally(() => server.stop(true))
      expect(url.searchParams.get("client_id")).toBe("registered")
      expect(registrations).toHaveLength(1)
    })

    test("reuses the client registered by an earlier login", async () => {
      const { server, registrations } = authorizationServer({})
      const previous = credential({ access: "a", refresh: "r", url: server.url.href })
      const client = { client_id: "registered", issuer: server.url.origin }
      const store = memoryCredentials([
        new Credential.Info({ ...previous, value: { ...previous.value, metadata: { client } } }),
      ])
      const { url } = await Effect.runPromise(Effect.scoped(start(server, undefined, store))).finally(() =>
        server.stop(true),
      )
      expect(url.searchParams.get("client_id")).toBe("registered")
      expect(registrations).toHaveLength(0)
    })

    test("registers dynamically when a custom redirect_uri is configured", async () => {
      const { server, registrations } = authorizationServer(cimd)
      const { url } = await Effect.runPromise(
        Effect.scoped(start(server, { redirect_uri: "http://127.0.0.1:0/custom" })),
      ).finally(() => server.stop(true))
      expect(url.searchParams.get("client_id")).toBe("registered")
      expect(registrations).toHaveLength(1)
    })
  })
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Config.node,
      Bus.node,
      Integration.node,
      Credential.node,
      Form.node,
      Environment.node,
      Location.node,
    ]),
    [
      Location.node.replace(
        Layer.succeed(
          Location.Service,
          Location.Service.of(location({ directory: AbsolutePath.make(import.meta.dir) })),
        ),
      ),
      Environment.node.replace(hostEnvironmentLayer),
    ],
  ),
)

// An OAuth-protected MCP server whose refresh tokens are single-use: replaying one returns invalid_grant.
// With hold, every 401 after the first waits until the first refresh was answered or an authorized request arrived.
const rotatingServer = Effect.fnUntraced(function* (input: {
  readonly refresh: string
  readonly hold?: "refreshed" | "authorized"
}) {
  const counts = { refresh: 0, invalidGrant: 0 }
  const state = {
    current: input.refresh,
    access: new Set<string>(),
    refreshed: Promise.withResolvers<void>(),
    authorized: Promise.withResolvers<void>(),
    rejections: 0,
  }
  const handler = createMcpHandler(() => {
    const protocol = new Server({ name: "mock", version: "1.0.0" }, { capabilities: { tools: {} } })
    protocol.setRequestHandler("tools/list", () =>
      Promise.resolve({ tools: [{ name: "echo", inputSchema: { type: "object" as const, properties: {} } }] }),
    )
    protocol.setRequestHandler("tools/call", () =>
      Promise.resolve({ content: [{ type: "text" as const, text: "ok" }] }),
    )
    return protocol
  })
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
        return Response.json({ resource: `${url.origin}/mcp`, authorization_servers: [url.origin] })
      if (url.pathname.startsWith("/.well-known/oauth-authorization-server"))
        return Response.json({
          issuer: url.origin,
          authorization_endpoint: `${url.origin}/authorize`,
          token_endpoint: `${url.origin}/token`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
        })
      if (url.pathname === "/token") {
        const body = new URLSearchParams(await request.text())
        counts.refresh++
        state.refreshed.resolve()
        if (body.get("refresh_token") !== state.current) {
          counts.invalidGrant++
          return Response.json({ error: "invalid_grant", error_description: "refresh token reused" }, { status: 400 })
        }
        state.current = `rt${counts.refresh}`
        const access = `at${counts.refresh}`
        state.access.add(access)
        return Response.json({
          access_token: access,
          token_type: "Bearer",
          refresh_token: state.current,
          expires_in: 3600,
        })
      }
      if (url.pathname !== "/mcp") return new Response(null, { status: 404 })
      if (!state.access.has((request.headers.get("authorization") ?? "").replace(/^Bearer /, ""))) {
        if (input.hold && state.rejections++ > 0) await state[input.hold].promise
        return new Response(null, {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`,
          },
        })
      }
      state.authorized.resolve()
      return handler.fetch(request)
    },
  })
  yield* Effect.addFinalizer(() => Effect.promise(() => server.stop(true)))
  return { url: `${server.url.origin}/mcp`, counts, state }
})

const rotatingConfig = (url: string) =>
  new ConfigMCP.Remote({ type: "remote", url, oauth: { client_id: "client" }, codemode: false })

const saveCredential = Effect.fnUntraced(function* (input: {
  readonly integrationID: Integration.ID
  readonly url: string
  readonly access: string
  readonly refresh: string
}) {
  const credentials = yield* Credential.Service
  return yield* credentials.create({
    integrationID: input.integrationID,
    value: Credential.OAuth.make({
      type: "oauth",
      methodID,
      access: input.access,
      refresh: input.refresh,
      expires: Date.now() - 1000,
      metadata: { serverUrl: input.url, tokenType: "Bearer" },
    }),
  })
})

// Each connection gets its own provider over the shared credential, like Locations or processes do. A
// slow save stands in for SQLite contention during a boot burst.
const connectAll = Effect.fnUntraced(function* (input: {
  readonly config: typeof ConfigMCP.Remote.Type
  readonly integrationID: Integration.ID
  readonly count: number
  readonly saveDelay?: number
}) {
  const credentials = yield* Credential.Service
  const slow = Credential.Service.of({
    ...credentials,
    update: (id, updates) => Effect.sleep(input.saveDelay ?? 0).pipe(Effect.andThen(credentials.update(id, updates))),
  })
  return yield* Effect.forEach(
    Array.from({ length: input.count }),
    () =>
      McpOAuth.connectProvider({ config: input.config, integrationID: input.integrationID }).pipe(
        Effect.flatMap((provider) => McpClient.connect("test", input.config, import.meta.dir, provider)),
        Effect.provideService(Credential.Service, slow),
        Effect.provide(hostEnvironmentLayer),
        Effect.exit,
      ),
    { concurrency: "unbounded" },
  )
})

describe("MCP OAuth refresh lock", () => {
  for (const saveDelay of [0, 50])
    it.live(`refreshes an expired credential once for 10 connections (save +${saveDelay} ms)`, () =>
      Effect.gen(function* () {
        // Later connections' 401s land right after the refresh response, while it is still being saved.
        const server = yield* rotatingServer({ refresh: "rt0", hold: "refreshed" })
        const integrationID = Integration.ID.make(`mcp_burst_${saveDelay}`)
        const saved = yield* saveCredential({ integrationID, url: server.url, access: "expired", refresh: "rt0" })
        const config = rotatingConfig(server.url)

        const exits = yield* connectAll({ config, integrationID, count: 10, saveDelay })

        expect(exits.filter(Exit.isSuccess)).toHaveLength(10)
        expect(server.counts).toEqual({ refresh: 1, invalidGrant: 0 })
        const stored = (yield* (yield* Credential.Service).get(saved.id))?.value
        expect(stored?.type === "oauth" && stored.refresh).toBe(server.state.current)
      }),
    )

  it.live("reuses tokens another connection saved after this one's 401", () =>
    Effect.gen(function* () {
      const server = yield* rotatingServer({ refresh: "rt0", hold: "authorized" })
      const integrationID = Integration.ID.make("mcp_late_401")
      yield* saveCredential({ integrationID, url: server.url, access: "expired", refresh: "rt0" })
      const config = rotatingConfig(server.url)

      // The second 401 arrives after the first connection saved rt1, so the SDK presents rt1, not rt0.
      const exits = yield* connectAll({ config, integrationID, count: 2 })

      expect(exits.filter(Exit.isSuccess)).toHaveLength(2)
      expect(server.counts).toEqual({ refresh: 1, invalidGrant: 0 })
    }),
  )

  it.live("refreshes a mid-session 401 once across connections", () =>
    Effect.gen(function* () {
      const server = yield* rotatingServer({ refresh: "rt0" })
      server.state.access.add("at0")
      const integrationID = Integration.ID.make("mcp_live_401")
      const saved = yield* saveCredential({ integrationID, url: server.url, access: "at0", refresh: "rt0" })
      const config = rotatingConfig(server.url)
      const [first, second] = yield* connectAll({ config, integrationID, count: 2, saveDelay: 50 })
      if (!first || !second || Exit.isFailure(first) || Exit.isFailure(second)) throw new Error("connect failed")
      expect(server.counts.refresh).toBe(0)

      // The access token expires; the second call's 401 lands while the first refresh is still saving.
      server.state.access.clear()
      const call = (connection: McpClient.Connection) => connection.callTool({ name: "echo" })
      const one = yield* call(first.value).pipe(Effect.forkScoped)
      yield* Effect.promise(() => server.state.refreshed.promise)
      const two = yield* call(second.value).pipe(Effect.forkScoped)

      expect(yield* Fiber.join(one)).toMatchObject({ content: [{ type: "text", text: "ok" }] })
      expect(yield* Fiber.join(two)).toMatchObject({ content: [{ type: "text", text: "ok" }] })
      expect(server.counts).toEqual({ refresh: 1, invalidGrant: 0 })
      const stored = (yield* (yield* Credential.Service).get(saved.id))?.value
      expect(stored?.type === "oauth" && stored.refresh).toBe(server.state.current)
    }),
  )

  it.live("keeps a rejected credential and asks for sign-in without refreshing again", () =>
    Effect.gen(function* () {
      const server = yield* rotatingServer({ refresh: "live" })
      const config = rotatingConfig(server.url)
      // The ID the Mcp layer gives the server's integration.
      const integrationID = Integration.ID.make(
        "mcp_" + createHash("sha1").update(`rejected\u0000${server.url}`).digest("hex").slice(0, 16),
      )
      const saved = yield* saveCredential({ integrationID, url: server.url, access: "expired", refresh: "dead" })
      const credentials = yield* Credential.Service
      const service = Context.get(yield* Layer.build(Mcp.layer()), Mcp.Service)
      yield* service.transform((editor) => editor.set("rejected", config))
      const status = Effect.gen(function* () {
        const current = (yield* service.servers()).find((server) => server.name === "rejected")?.status
        if (!current || current.status === "pending") return yield* Effect.fail("pending")
        return current
      }).pipe(Effect.retry(Schedule.spaced("5 millis")), Effect.timeout("10 seconds"))
      expect(yield* status).toMatchObject({ status: "needs_auth" })

      // Reconnecting asks for sign-in again without presenting the rejected refresh token.
      yield* service.connect("rejected")
      expect(yield* status).toMatchObject({ status: "needs_auth" })

      expect(server.counts).toEqual({ refresh: 1, invalidGrant: 1 })
      expect(yield* credentials.get(saved.id)).toEqual(saved)
    }),
  )
})
