import { afterAll, describe, expect, test } from "bun:test"
import { auth, InsufficientScopeError, refreshAuthorization } from "@modelcontextprotocol/client"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { McpClient } from "@opencode/core/mcp/client"
import { McpOAuth } from "@opencode/core/mcp/oauth"
import { Cause, Effect, Exit, Fiber, Logger, Scope, Semaphore } from "effect"
import { Environment } from "@opencode/core/environment/index"
import { FetchHttpClient } from "effect/http"
import { hostEnvironmentLayer } from "./fixture/environment"

const authServer = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) })
afterAll(() => authServer.stop(true))

const integrationID = Integration.ID.make("mcp_test")
const methodID = Integration.MethodID.make("oauth")

const remote = (url: string) => new ConfigMCP.Remote({ type: "remote", url, oauth: { client_id: "client" } })
const credential = (input: {
  access: string
  refresh: string
  expires?: number
  url: string
  scope?: string
  issuer?: string
  client?: Record<string, unknown>
}) =>
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
      metadata: {
        serverUrl: input.url,
        tokenType: "Bearer",
        ...(input.scope ? { scope: input.scope } : {}),
        ...(input.issuer ? { issuer: input.issuer } : {}),
        ...(input.client ? { client: input.client } : {}),
      },
    },
  })

// Connect-time providers read and write the credential store; this one lives in memory so tests can
// inspect the row the provider leaves behind.
const memoryCredentials = (
  initial: Credential.Info[],
  options?: { beforeOperation?: () => void | Promise<void> },
) => {
  const rows = new Map(initial.map((row) => [row.id, row]))
  const unused = () => Effect.die("unused credential method")
  const lock = Semaphore.makeUnsafe(1)
  let lockCalls = 0
  const before = options?.beforeOperation
  const service = Credential.Service.of({
    lock: (_id, operation) =>
      lock.withPermit(
        Effect.sync(() => {
          lockCalls++
        }).pipe(
          Effect.andThen(before ? Effect.promise(async () => before()) : Effect.void),
          Effect.andThen(operation),
        ),
      ),
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
  return { rows, service, lockCalls: () => lockCalls }
}

const connectAuth = (
  config: typeof ConfigMCP.Remote.Type,
  store: ReturnType<typeof memoryCredentials>,
  options?: { timeoutMs?: number; logs?: unknown[] },
) => {
  const effect = McpOAuth.connectProvider({
    config,
    credential: Array.from(store.rows.values()).at(-1),
    ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  }).pipe(Effect.provideService(Credential.Service, store.service))
  const logs = options?.logs
  if (!logs) return Effect.runPromise(effect)
  const logger = Logger.make(({ message }) => {
    logs.push(message)
  })
  return Effect.runPromise(
    effect.pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false }))),
  )
}

const connectProvider = async (
  config: typeof ConfigMCP.Remote.Type,
  store: ReturnType<typeof memoryCredentials>,
) => (await connectAuth(config, store)).provider

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

type MockMcpRequest = {
  readonly method: string
  readonly authorization: string | null
  readonly headers: Headers
  readonly body: { readonly id?: string | number; readonly method?: string; readonly params?: { readonly name?: string } }
}

// A small Streamable HTTP MCP server plus its OAuth authorization/token endpoints. It accepts the
// stale bearer with 200 so a missing proactive refresh cannot be masked by the SDK's 401 path.
const mockMcpServer = () => {
  const mcpRequests: MockMcpRequest[] = []
  const tokenRequests: Array<{ readonly headers: Headers; readonly body: URLSearchParams }> = []
  const authorizeRequests: string[] = []
  const deleteRequests: Request[] = []
  let mcpMode: "ok" | "401" | "403" = "ok"
  let tokenMode: "ok" | "invalid_grant" | "never" = "ok"
  let tokenDelayMs = 0
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const origin = url.origin
      if (url.pathname === "/as.json")
        return Response.json({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          scopes_supported: ["read", "write", "offline_access"],
          token_endpoint_auth_methods_supported: ["none"],
        })
      if (url.pathname === "/authorize") {
        authorizeRequests.push(url.href)
        return new Response(null, { status: 302, headers: { location: `${origin}/callback` } })
      }
      if (request.method === "POST" && url.pathname === "/token") {
        tokenRequests.push({ headers: new Headers(request.headers), body: new URLSearchParams(await request.text()) })
        if (tokenDelayMs) await Bun.sleep(tokenDelayMs)
        if (tokenMode === "never") return new Promise<Response>(() => {})
        if (tokenMode === "invalid_grant")
          return Response.json({ error: "invalid_grant", error_description: "rejected" }, { status: 400 })
        return Response.json({
          access_token: "next-access",
          token_type: "Bearer",
          refresh_token: "next-refresh",
          expires_in: 7200,
        })
      }
      if (url.pathname === "/mcp" && request.method === "DELETE") {
        deleteRequests.push(request)
        return new Response(null, { status: 204 })
      }
      if (url.pathname === "/mcp" && request.method === "GET") return new Response(null, { status: 405 })
      if (url.pathname === "/mcp" && request.method === "POST") {
        const body = (await request.json()) as MockMcpRequest["body"]
        mcpRequests.push({
          method: request.method,
          authorization: request.headers.get("authorization"),
          headers: new Headers(request.headers),
          body,
        })
        if (mcpMode === "401" && body.method === "initialize") {
          mcpMode = "ok"
          return new Response(null, { status: 401, headers: { "WWW-Authenticate": "Bearer" } })
        }
        if (mcpMode === "403" && body.method === "initialize") {
          mcpMode = "ok"
          return new Response(null, {
            status: 403,
            headers: { "WWW-Authenticate": 'Bearer error="insufficient_scope", scope="read write"' },
          })
        }
        const result = (value: unknown) =>
          Response.json(
            { jsonrpc: "2.0", id: body.id, result: value },
            { headers: { "Mcp-Session-Id": "session-test" } },
          )
        if (body.method === "initialize")
          return result({
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "mock", version: "1.0.0" },
          })
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 })
        if (body.method === "tools/list")
          return result({ tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object", properties: {} } }] })
        if (body.method === "tools/call") return result({ content: [{ type: "text", text: "ok" }], isError: false })
        return new Response(null, { status: 404 })
      }
      return new Response(null, { status: 404 })
    },
  })
  return {
    server,
    mcpRequests,
    tokenRequests,
    authorizeRequests,
    deleteRequests,
    setMcpMode: (mode: typeof mcpMode) => {
      mcpMode = mode
    },
    setTokenMode: (mode: typeof tokenMode) => {
      tokenMode = mode
    },
    setTokenDelay: (ms: number) => {
      tokenDelayMs = ms
    },
  }
}

const withConnection = <A, E>(
  config: typeof ConfigMCP.Remote.Type,
  authValue: McpOAuth.Auth | undefined,
  run: (connection: McpClient.Connection) => Effect.Effect<A, E>,
  options?: { fetch?: typeof fetch },
) => {
  const effect = Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* McpClient.connect({
        server: "test",
        config,
        directory: import.meta.dir,
        authProvider: authValue,
      })
      return yield* run(connection)
    }),
  )
  const withFetch = options?.fetch ? effect.pipe(Effect.provideService(FetchHttpClient.Fetch, options.fetch)) : effect
  return Effect.runPromise(withFetch.pipe(Effect.provide(hostEnvironmentLayer)))
}

const exitOf = <A, E>(effect: Effect.Effect<A, E, Scope.Scope | Environment.Service>) =>
  Effect.runPromise(Effect.scoped(Effect.exit(effect)).pipe(Effect.provide(hostEnvironmentLayer)))

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

  test("completes from a pasted redirect URL and keeps waiting after a wrong paste", async () => {
    const tokenRequests: URLSearchParams[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        if (request.method !== "POST" || new URL(request.url).pathname !== "/token")
          return new Response(null, { status: 404 })
        tokenRequests.push(new URLSearchParams(await request.text()))
        return Response.json({ access_token: "access", token_type: "Bearer", refresh_token: "refresh", expires_in: 3600 })
      },
    })

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { authorization, url: authorizationUrl } = yield* start(server, { client_id: "client" })
          const redirect = new URL(authorizationUrl.searchParams.get("redirect_uri") ?? "")
          redirect.searchParams.set("code", "pasted")
          redirect.searchParams.set("state", "another-sign-in")
          const rejected = yield* Effect.flip(authorization.submit(redirect.href))
          const notURL = yield* Effect.flip(authorization.submit("pasted"))
          redirect.searchParams.set("state", authorizationUrl.searchParams.get("state") ?? "")
          yield* authorization.submit(` ${redirect.href}\n`)
          return { rejected, notURL, credential: yield* authorization.callback }
        }),
      ),
    ).finally(() => server.stop(true))

    expect(result.rejected.message).toBe("This URL belongs to a different sign-in")
    expect(result.notURL.message).toBe("Paste the full URL from the browser's address bar")
    expect(result.credential.access).toBe("access")
    expect(tokenRequests).toHaveLength(1)
    expect(tokenRequests[0]?.get("code")).toBe("pasted")
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

    const result = await auth(oauthProvider, { serverUrl: server.url.href }).finally(() => server.stop(true))

    expect(result).toBe("AUTHORIZED")
    expect(tokenRequests).toHaveLength(1)
    expect(tokenRequests[0]?.get("grant_type")).toBe("refresh_token")
    expect(tokenRequests[0]?.get("refresh_token")).toBe("refresh")
    // The refreshed tokens land on the same credential row, stamped with the issuer they were minted by.
    const stored = store.rows.get(Credential.ID.make("cred_test"))?.value
    expect(stored?.type === "oauth" && stored.access).toBe("next")
    expect(stored?.type === "oauth" && stored.metadata?.issuer).toBe(server.url.href)
  })

  test("refreshes the credential it was made with, not the one signed in since", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (request.method !== "POST" || url.pathname !== "/token") return new Response(null, { status: 404 })
        const refresh = new URLSearchParams(await request.text()).get("refresh_token")
        return Response.json({ access_token: `next-for-${refresh}`, token_type: "Bearer" })
      },
    })
    const selected = credential({ access: "expired", refresh: "refresh", url: server.url.href })
    const newer = new Credential.Info({
      ...credential({
        access: "other",
        refresh: "other-refresh",
        url: server.url.href,
        expires: Date.now() + 3_600_000,
      }),
      id: Credential.ID.make("cred_newer"),
    })
    const store = memoryCredentials([selected, newer])
    const { provider: oauthProvider } = await Effect.runPromise(
      McpOAuth.connectProvider({ config: remote(server.url.href), credential: selected }).pipe(
        Effect.provideService(Credential.Service, store.service),
      ),
    )

    const result = await auth(oauthProvider, { serverUrl: server.url.href }).finally(() => server.stop(true))

    expect(result).toBe("AUTHORIZED")
    expect((await oauthProvider.tokens())?.access_token).toBe("next-for-refresh")
    const stored = store.rows.get(selected.id)?.value
    expect(stored?.type === "oauth" && stored.access).toBe("next-for-refresh")
    const untouched = store.rows.get(newer.id)?.value
    expect(untouched?.type === "oauth" && untouched.access).toBe("other")
  })

  test("stays anonymous when made without a credential, even after one is signed in", async () => {
    const store = memoryCredentials([])
    const { provider: oauthProvider } = await Effect.runPromise(
      McpOAuth.connectProvider({ config: remote(authServer.url.href), credential: undefined }).pipe(
        Effect.provideService(Credential.Service, store.service),
      ),
    )
    store.rows.set(
      Credential.ID.make("cred_test"),
      credential({ access: "late", refresh: "late", url: authServer.url.href }),
    )
    expect(await oauthProvider.tokens()).toBeUndefined()
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
    const authValue = await connectAuth(config, memoryCredentials([]))

    const exit = await Effect.runPromise(
      Effect.scoped(
        McpClient.connect({ server: "test", config, directory: import.meta.dir, authProvider: authValue }),
      ).pipe(Effect.provide(hostEnvironmentLayer), Effect.exit),
    ).finally(() => server.stop(true))

    const error = Exit.isFailure(exit) && Cause.squash(exit.cause)
    expect(error).toBeInstanceOf(McpClient.NeedsAuthError)
    expect(error instanceof McpClient.NeedsAuthError && error.message).toBe(
      `MCP server "${config.url}" requires a login before it can register a client`,
    )
    expect(registrations).toBe(0)
  })

  test("invalidates only the presented credential and keeps the row", async () => {
    const url = authServer.url.href
    const rotated = memoryCredentials([credential({ access: "a", refresh: "r1", url })])
    const rotatedProvider = await connectProvider(remote(url), rotated)
    await rotatedProvider.tokens()
    // Another connection refreshed first; the row now holds a token this provider never presented.
    await Effect.runPromise(
      rotated.service.update(Credential.ID.make("cred_test"), {
        value: credential({ access: "b", refresh: "r2", url }).value,
      }),
    )
    await rotatedProvider.invalidateCredentials?.("tokens")
    expect(rotated.rows.size).toBe(1)
    expect((rotated.rows.get(Credential.ID.make("cred_test"))?.value as Credential.OAuth).refresh).toBe("r2")

    const current = memoryCredentials([credential({ access: "a", refresh: "r1", url })])
    const currentProvider = await connectProvider(remote(url), current)
    await currentProvider.tokens()
    await currentProvider.invalidateCredentials?.("tokens")
    expect(current.rows.size).toBe(1)
    expect((current.rows.get(Credential.ID.make("cred_test"))?.value as Credential.OAuth).refresh).toBe("r1")
    expect((await currentProvider.tokens())?.refresh_token).toBeUndefined()

    // The raw 401-path save must not overwrite a newer row after a tokens() read.
    const staleSave = memoryCredentials([credential({ access: "a", refresh: "r1", url })])
    const staleProvider = await connectProvider(remote(url), staleSave)
    await staleProvider.tokens()
    await Effect.runPromise(
      staleSave.service.update(Credential.ID.make("cred_test"), {
        value: credential({ access: "b", refresh: "r2", url }).value,
      }),
    )
    await staleProvider.saveTokens({ access_token: "stale", token_type: "Bearer", refresh_token: "r1" })
    expect((staleSave.rows.get(Credential.ID.make("cred_test"))?.value as Credential.OAuth).refresh).toBe("r2")
    expect(staleSave.rows.size).toBe(1)
  })

  test("shares concurrent refreshes for the same token", async () => {
    let requests = 0
    const pending = Promise.withResolvers<void>()
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = new URLSearchParams(await request.text())
        if (body.get("grant_type") !== "refresh_token") return new Response(null, { status: 404 })
        requests++
        await pending.promise
        return Response.json({ access_token: "access", token_type: "Bearer", refresh_token: "next" })
      },
    })
    const fetchFn = await Effect.runPromise(McpOAuth.loggedFetch({ server: "test" }))
    const options = {
      metadata: {
        issuer: server.url.origin,
        authorization_endpoint: `${server.url.origin}/authorize`,
        token_endpoint: `${server.url.origin}/token`,
        response_types_supported: ["code"],
      },
      clientInformation: { client_id: "client" },
      refreshToken: "refresh",
      fetchFn,
    }

    const first = refreshAuthorization(new URL(server.url.origin), options)
    const second = refreshAuthorization(new URL(server.url.origin), options)
    // Both refreshes must reach the token endpoint before the shared response is released.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(requests).toBe(1)
    pending.resolve()
    const results = await Promise.all([first, second]).finally(() => server.stop(true))
    expect(results).toEqual([
      { access_token: "access", token_type: "Bearer", refresh_token: "next" },
      { access_token: "access", token_type: "Bearer", refresh_token: "next" },
    ])
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
      expect(registrations[0]).toMatchObject({
        client_name: "opencode",
        client_uri: "https://opencode.ai",
        logo_uri: "https://opencode.ai/web-app-manifest-512x512.png",
      })
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

  test("refreshes an expired stored credential before the MCP initialize request", async () => {
    const mock = mockMcpServer()
    const origin = mock.server.url.origin
    const config = new ConfigMCP.Remote({
      type: "remote",
      url: `${origin}/mcp`,
      headers: { "X-LDMC-Test": "keep" },
      oauth: { auth_server_metadata_url: `${origin}/as.json` },
    })
    const store = memoryCredentials([
      credential({
        access: "old-access",
        refresh: "r1",
        expires: Date.now() - 1_000,
        url: config.url,
        scope: "read",
        client: { client_id: "stored-client", token_endpoint_auth_method: "none" },
      }),
    ])
    const authValue = await connectAuth(config, store)
    try {
      await withConnection(config, authValue, (connection) => connection.tools())
    } finally {
      mock.server.stop(true)
    }

    expect(mock.tokenRequests).toHaveLength(1)
    expect(mock.tokenRequests[0]?.body.get("grant_type")).toBe("refresh_token")
    expect(mock.tokenRequests[0]?.body.get("client_id")).toBe("stored-client")
    expect(mock.tokenRequests[0]?.headers.get("x-ldmc-test")).toBe("keep")
    expect(mock.tokenRequests[0]?.headers.get("authorization")).toBeNull()
    expect(mock.mcpRequests.find((entry) => entry.body.method === "initialize")?.authorization).toBe(
      "Bearer next-access",
    )
    expect(mock.authorizeRequests).toHaveLength(0)
    const row = store.rows.get(Credential.ID.make("cred_test"))?.value
    expect(row?.type === "oauth" && row.access).toBe("next-access")
  })

  test("does not refresh a non-expiring credential", async () => {
    const mock = mockMcpServer()
    const origin = mock.server.url.origin
    const config = new ConfigMCP.Remote({
      type: "remote",
      url: `${origin}/mcp`,
      oauth: { auth_server_metadata_url: `${origin}/as.json` },
    })
    const store = memoryCredentials([
      credential({
        access: "keep-access",
        refresh: "r1",
        expires: 0,
        url: config.url,
        client: { client_id: "stored-client", token_endpoint_auth_method: "none" },
      }),
    ])
    const authValue = await connectAuth(config, store)
    try {
      await withConnection(config, authValue, (connection) => connection.tools())
    } finally {
      mock.server.stop(true)
    }
    expect(mock.tokenRequests).toHaveLength(0)
    expect(mock.mcpRequests.find((entry) => entry.body.method === "initialize")?.authorization).toBe("Bearer keep-access")
  })

  test("refreshes after a 401 from the MCP server and retries", async () => {
    const mock = mockMcpServer()
    const origin = mock.server.url.origin
    const config = new ConfigMCP.Remote({
      type: "remote",
      url: `${origin}/mcp`,
      oauth: { auth_server_metadata_url: `${origin}/as.json` },
    })
    const store = memoryCredentials([
      credential({
        access: "old-access",
        refresh: "r1",
        expires: Date.now() + 3_600_000,
        url: config.url,
        client: { client_id: "stored-client", token_endpoint_auth_method: "none" },
      }),
    ])
    const authValue = await connectAuth(config, store)
    mock.setMcpMode("401")
    try {
      await withConnection(config, authValue, (connection) => connection.tools())
    } finally {
      mock.server.stop(true)
    }
    expect(mock.tokenRequests).toHaveLength(1)
    expect(mock.tokenRequests[0]?.headers.get("authorization")).toBeNull()
    const initializes = mock.mcpRequests.filter((entry) => entry.body.method === "initialize")
    expect(initializes.map((entry) => entry.authorization)).toEqual(["Bearer old-access", "Bearer next-access"])
  })

  test("shares one proactive refresh across concurrent MCP requests", async () => {
    const mock = mockMcpServer()
    const origin = mock.server.url.origin
    const config = new ConfigMCP.Remote({
      type: "remote",
      url: `${origin}/mcp`,
      oauth: { auth_server_metadata_url: `${origin}/as.json` },
    })
    const store = memoryCredentials([
      credential({
        access: "old-access",
        refresh: "r1",
        expires: Date.now() + 3_600_000,
        url: config.url,
        client: { client_id: "stored-client", token_endpoint_auth_method: "none" },
      }),
    ])
    const authValue = await connectAuth(config, store)
    mock.setTokenDelay(50)
    try {
      const results = await withConnection(config, authValue, (connection) =>
        Effect.gen(function* () {
          const row = store.rows.get(Credential.ID.make("cred_test"))?.value
          if (row?.type === "oauth")
            yield* store.service.update(Credential.ID.make("cred_test"), {
              value: { ...row, expires: Date.now() + 1_000 },
            })
          return yield* Effect.all(
            [connection.callTool({ name: "echo", args: {} }), connection.callTool({ name: "echo", args: {} })],
            { concurrency: "unbounded" },
          )
        }),
      )
      expect(results).toHaveLength(2)
      expect(mock.tokenRequests).toHaveLength(1)
      expect(store.lockCalls()).toBe(2)
      const calls = mock.mcpRequests.filter((entry) => entry.body.method === "tools/call")
      expect(calls.every((entry) => entry.authorization === "Bearer next-access")).toBe(true)
    } finally {
      mock.server.stop(true)
    }
  })

  test("keeps the credential when a proactive refresh is rejected", async () => {
    const mock = mockMcpServer()
    const origin = mock.server.url.origin
    const config = new ConfigMCP.Remote({
      type: "remote",
      url: `${origin}/mcp`,
      oauth: { auth_server_metadata_url: `${origin}/as.json` },
    })
    const store = memoryCredentials([
      credential({
        access: "old-access",
        refresh: "r1",
        expires: Date.now() + 3_600_000,
        url: config.url,
        client: { client_id: "stored-client", token_endpoint_auth_method: "none" },
      }),
    ])
    const authValue = await connectAuth(config, store)
    mock.setTokenMode("invalid_grant")
    try {
      const exit = await withConnection(config, authValue, (connection) =>
        Effect.gen(function* () {
          const row = store.rows.get(Credential.ID.make("cred_test"))?.value
          if (row?.type === "oauth")
            yield* store.service.update(Credential.ID.make("cred_test"), {
              value: { ...row, expires: Date.now() + 1_000 },
            })
          return yield* Effect.exit(connection.callTool({ name: "echo", args: {} }))
        }),
      )
      const error = Exit.isFailure(exit) && Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(Error)
      expect(error instanceof Error && error.message).toContain("requires user authorization")
      expect(mock.tokenRequests).toHaveLength(1)
      expect(mock.authorizeRequests).toHaveLength(0)
      const row = store.rows.get(Credential.ID.make("cred_test"))?.value
      expect(row?.type === "oauth" && row.refresh).toBe("r1")
      expect((await authValue.provider.tokens())?.refresh_token).toBeUndefined()

      // A fresh provider from the same row retries the rejected token through the SDK's 401 path.
      mock.setMcpMode("401")
      mock.setTokenMode("invalid_grant")
      const next = await connectAuth(config, store)
      const nextExit = await exitOf(
        McpClient.connect({ server: "test", config, directory: import.meta.dir, authProvider: next }),
      )
      const nextError = Exit.isFailure(nextExit) && Cause.squash(nextExit.cause)
      expect(nextError).toBeInstanceOf(McpClient.NeedsAuthError)
      expect(store.rows.size).toBe(1)
    } finally {
      mock.server.stop(true)
    }
  })

  test("bounds a hung proactive refresh and keeps the row", async () => {
    const mock = mockMcpServer()
    const origin = mock.server.url.origin
    const config = new ConfigMCP.Remote({
      type: "remote",
      url: `${origin}/mcp`,
      oauth: { auth_server_metadata_url: `${origin}/as.json` },
    })
    const store = memoryCredentials([
      credential({
        access: "old-access",
        refresh: "r1",
        expires: Date.now() + 3_600_000,
        url: config.url,
        client: { client_id: "stored-client", token_endpoint_auth_method: "none" },
      }),
    ])
    const authValue = await connectAuth(config, store, { timeoutMs: 75 })
    mock.setTokenMode("never")
    const started = Date.now()
    try {
      const exit = await withConnection(config, authValue, (connection) =>
        Effect.gen(function* () {
          const row = store.rows.get(Credential.ID.make("cred_test"))?.value
          if (row?.type === "oauth")
            yield* store.service.update(Credential.ID.make("cred_test"), {
              value: { ...row, expires: Date.now() + 1_000 },
            })
          return yield* Effect.exit(connection.callTool({ name: "echo", args: {} }))
        }),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      expect(Date.now() - started).toBeLessThan(2_000)
      const row = store.rows.get(Credential.ID.make("cred_test"))?.value
      expect(row?.type === "oauth" && row.refresh).toBe("r1")
    } finally {
      mock.server.stop(true)
    }
  })

  test("writes a late refresh only while the row still holds the attempt's token", async () => {
    const mock = mockMcpServer()
    const origin = mock.server.url.origin
    const config = new ConfigMCP.Remote({
      type: "remote",
      url: `${origin}/mcp`,
      oauth: { auth_server_metadata_url: `${origin}/as.json` },
    })
    const store = memoryCredentials([
      credential({
        access: "old-access",
        refresh: "r1",
        expires: Date.now() + 3_600_000,
        url: config.url,
        client: { client_id: "stored-client", token_endpoint_auth_method: "none" },
      }),
    ])
    const logs: unknown[] = []
    const authValue = await connectAuth(config, store, { timeoutMs: 75, logs })
    const started = Promise.withResolvers<void>()
    let release: (() => void) | undefined
    const delayed = new Promise<Response>((resolve) => {
      release = () =>
        resolve(
          Response.json({
            access_token: "late-access",
            token_type: "Bearer",
            refresh_token: "next-refresh",
            expires_in: 7200,
          }),
        )
    })
    const customFetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        if (new URL(String(input)).pathname === "/token") {
          started.resolve()
          return delayed
        }
        return fetch(input, init)
      },
      { preconnect: fetch.preconnect },
    )
    try {
      const exit = await withConnection(
        config,
        authValue,
        (connection): Effect.Effect<Credential.Value | undefined> =>
          Effect.gen(function* () {
            const row = store.rows.get(Credential.ID.make("cred_test"))?.value
            if (row?.type === "oauth")
              yield* store.service.update(Credential.ID.make("cred_test"), {
                value: { ...row, expires: Date.now() + 1_000 },
              })
            const fiber = yield* Effect.forkChild(Effect.exit(connection.callTool({ name: "echo", args: {} })))
            yield* Effect.promise(() => started.promise)
            const newer = store.rows.get(Credential.ID.make("cred_test"))?.value
            if (newer?.type === "oauth")
              yield* store.service.update(Credential.ID.make("cred_test"), {
                value: { ...newer, access: "row2-access", refresh: "r2" },
              })
            yield* Effect.promise(async () => authValue.provider.tokens())
            release?.()
            yield* Fiber.join(fiber)
            yield* Effect.promise(() => Bun.sleep(50))
            return store.rows.get(Credential.ID.make("cred_test"))?.value
          }),
        { fetch: customFetch },
      )
      expect(exit?.type === "oauth" && exit.refresh).toBe("r2")
      expect(exit?.type === "oauth" && exit.access).toBe("row2-access")
      expect(logs.some((entry) => JSON.stringify(entry).includes("mcp oauth stale token save skipped"))).toBe(true)
    } finally {
      mock.server.stop(true)
    }
  })

  test("preserves a custom Authorization header for a non-OAuth remote server", async () => {
    const mock = mockMcpServer()
    const origin = mock.server.url.origin
    const config = new ConfigMCP.Remote({
      type: "remote",
      url: `${origin}/mcp`,
      oauth: false,
      headers: { Authorization: "Bearer custom" },
    })
    try {
      await withConnection(config, undefined, (connection) => connection.tools())
    } finally {
      mock.server.stop(true)
    }
    expect(mock.mcpRequests.find((entry) => entry.body.method === "initialize")?.authorization).toBe("Bearer custom")
    expect(mock.tokenRequests).toHaveLength(0)
  })

  test("reports needs_auth on a 403 insufficient_scope without a redirect", async () => {
    const mock = mockMcpServer()
    const origin = mock.server.url.origin
    const config = new ConfigMCP.Remote({
      type: "remote",
      url: `${origin}/mcp`,
      oauth: { auth_server_metadata_url: `${origin}/as.json` },
    })
    const store = memoryCredentials([
      credential({
        access: "old-access",
        refresh: "r1",
        expires: Date.now() + 3_600_000,
        url: config.url,
        scope: "read",
        client: { client_id: "stored-client", token_endpoint_auth_method: "none" },
      }),
    ])
    const authValue = await connectAuth(config, store)
    mock.setMcpMode("403")
    try {
      const exit = await exitOf(
        McpClient.connect({ server: "test", config, directory: import.meta.dir, authProvider: authValue }),
      )
      const error = Exit.isFailure(exit) && Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(McpClient.NeedsAuthError)
      expect(error).not.toBeInstanceOf(InsufficientScopeError)
      expect(mock.authorizeRequests).toHaveLength(0)
    } finally {
      mock.server.stop(true)
    }
  })

  test("ends in needs_auth when a near-expiry credential has no refresh token", async () => {
    const mock = mockMcpServer()
    const origin = mock.server.url.origin
    const config = new ConfigMCP.Remote({
      type: "remote",
      url: `${origin}/mcp`,
      oauth: { auth_server_metadata_url: `${origin}/as.json` },
    })
    const noRefresh = memoryCredentials([
      credential({
        access: "old-access",
        refresh: "",
        expires: Date.now() - 1_000,
        url: config.url,
        client: { client_id: "stored-client", token_endpoint_auth_method: "none" },
      }),
    ])
    const authValue = await connectAuth(config, noRefresh)
    try {
      const exit = await exitOf(
        McpClient.connect({ server: "test", config, directory: import.meta.dir, authProvider: authValue }),
      )
      const error = Exit.isFailure(exit) && Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(McpClient.NeedsAuthError)
      expect(mock.mcpRequests).toHaveLength(0)
      expect(noRefresh.rows.size).toBe(1)
    } finally {
      mock.server.stop(true)
    }

    const lostMock = mockMcpServer()
    const lostOrigin = lostMock.server.url.origin
    const lostConfig = new ConfigMCP.Remote({
      type: "remote",
      url: `${lostOrigin}/mcp`,
      oauth: { auth_server_metadata_url: `${lostOrigin}/as.json` },
    })
    const id = Credential.ID.make("cred_test")
    let lostRows: ReturnType<typeof memoryCredentials>["rows"] | undefined
    const lost = memoryCredentials(
      [
        credential({
          access: "old-access",
          refresh: "r1",
          expires: Date.now() - 1_000,
          url: lostConfig.url,
          client: { client_id: "stored-client", token_endpoint_auth_method: "none" },
        }),
      ],
      {
        beforeOperation: () => {
          const row = lostRows?.get(id)
          if (row?.value.type === "oauth")
            lostRows?.set(id, new Credential.Info({ ...row, value: { ...row.value, refresh: "" } }))
        },
      },
    )
    lostRows = lost.rows
    const lostAuth = await connectAuth(lostConfig, lost)
    try {
      const exit = await exitOf(
        McpClient.connect({ server: "test", config: lostConfig, directory: import.meta.dir, authProvider: lostAuth }),
      )
      const error = Exit.isFailure(exit) && Cause.squash(exit.cause)
      expect(error).toBeInstanceOf(McpClient.NeedsAuthError)
      expect(lostMock.mcpRequests).toHaveLength(0)
      expect(lost.rows.size).toBe(1)
    } finally {
      lostMock.server.stop(true)
    }
  })

  test("skips the proactive refresh on DELETE teardown", async () => {
    const mock = mockMcpServer()
    const origin = mock.server.url.origin
    const config = new ConfigMCP.Remote({
      type: "remote",
      url: `${origin}/mcp`,
      oauth: { auth_server_metadata_url: `${origin}/as.json` },
    })
    const store = memoryCredentials([
      credential({
        access: "old-access",
        refresh: "r1",
        expires: Date.now() + 3_600_000,
        url: config.url,
        client: { client_id: "stored-client", token_endpoint_auth_method: "none" },
      }),
    ])
    const authValue = await connectAuth(config, store)
    try {
      await withConnection(config, authValue, (connection) =>
        Effect.gen(function* () {
          const tools = yield* connection.tools()
          const row = store.rows.get(Credential.ID.make("cred_test"))?.value
          if (row?.type === "oauth")
            yield* store.service.update(Credential.ID.make("cred_test"), {
              value: { ...row, expires: Date.now() + 1_000 },
            })
          return tools
        }),
      )
      await Bun.sleep(20)
      expect(mock.deleteRequests).toHaveLength(1)
      expect(mock.tokenRequests).toHaveLength(0)
    } finally {
      mock.server.stop(true)
    }
  })

  test("drops only client metadata and respects the presented-token guard", async () => {
    const url = authServer.url.href
    const id = Credential.ID.make("cred_test")
    const store = memoryCredentials([credential({ access: "a", refresh: "r1", url, client: { client_id: "c1" } })])
    const authValue = await connectAuth(remote(url), store)
    await authValue.provider.tokens()
    await authValue.provider.invalidateCredentials?.("client")
    const cleared = store.rows.get(id)?.value
    expect(cleared?.type === "oauth" && cleared.metadata?.client).toBeUndefined()
    expect(cleared?.type === "oauth" && cleared.access).toBe("a")
    expect(cleared?.type === "oauth" && cleared.refresh).toBe("r1")

    const guardStore = memoryCredentials([credential({ access: "a", refresh: "r1", url, client: { client_id: "c1" } })])
    const guard = await connectAuth(remote(url), guardStore)
    await guard.provider.tokens()
    await Effect.runPromise(
      guardStore.service.update(id, {
        value: credential({ access: "b", refresh: "r2", url, client: { client_id: "c2" } }).value,
      }),
    )
    await guard.provider.invalidateCredentials?.("client")
    const stale = guardStore.rows.get(id)?.value
    expect(stale?.type === "oauth" && stale.metadata?.client).toEqual({ client_id: "c2" })

    await guard.provider.tokens()
    await guard.provider.invalidateCredentials?.("client")
    const refreshed = guardStore.rows.get(id)?.value
    expect(refreshed?.type === "oauth" && refreshed.metadata?.client).toBeUndefined()
    expect(refreshed?.type === "oauth" && refreshed.refresh).toBe("r2")
  })

  test("aborts a fetch at the timeout with and without a caller signal", async () => {
    const signals: AbortSignal[] = []
    const fetchFn = async (_url: string | URL, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal)
      return new Response("ok")
    }
    const timed = McpOAuth.withTimeout(fetchFn, 10)
    await timed("http://example.test/one", {})
    const controller = new AbortController()
    await timed("http://example.test/two", { signal: controller.signal })
    expect(signals).toHaveLength(2)
    expect(signals[0]).toBeInstanceOf(AbortSignal)
    expect(signals[1]).toBeInstanceOf(AbortSignal)
    controller.abort()
    expect(signals[1]?.aborted).toBe(true)
    await new Promise<void>((resolve) => {
      const signal = signals[0]
      if (!signal || signal.aborted) return resolve()
      signal.addEventListener("abort", () => resolve(), { once: true })
    })
    expect(signals[0]?.aborted).toBe(true)
  })
})
