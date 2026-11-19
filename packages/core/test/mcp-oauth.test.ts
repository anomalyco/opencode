import { afterAll, describe, expect, test } from "bun:test"
import { OAuthError, UnauthorizedError, type AuthProvider } from "@modelcontextprotocol/client"
import path from "path"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Integration } from "@opencode/core/integration"
import { McpClient } from "@opencode/core/mcp/client"
import { McpOAuth } from "@opencode/core/mcp/oauth"
import { Cause, Effect, Exit, ManagedRuntime } from "effect"
import { TestClock } from "effect/testing"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

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
    refresh: unused,
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
    expect(credential.metadata?.discovery).toEqual({ authorizationServer: server.url.href, resource: server.url.href })
  })

  test("keeps waiting for the redirect after callback requests without OAuth parameters", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        if (request.method !== "POST" || new URL(request.url).pathname !== "/token")
          return new Response(null, { status: 404 })
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
        return Response.json({
          access_token: "access",
          token_type: "Bearer",
          refresh_token: "refresh",
          expires_in: 3600,
        })
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
        return Response.json({ error: "invalid_client", error_description: "bad_client_secret" }, { status: 400 })
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
    resource.stop(true)
    issuer.stop(true)
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

    test("redeems the code with the localhost redirect a server sent the browser back to", async () => {
      const { server, registrations, tokenRequests } = authorizationServer({})
      const sent = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const { authorization, url } = yield* start(server)
            const redirect = new URL(url.searchParams.get("redirect_uri")!)
            redirect.searchParams.set("code", "accepted")
            redirect.searchParams.set("state", url.searchParams.get("state")!)
            // Clerk's consent page rewrites 127.0.0.1 to localhost; the browser reaches the same listener.
            yield* Effect.promise(() => fetch(redirect, { headers: { host: `localhost:${redirect.port}` } }))
            yield* authorization.callback
            return redirect
          }),
        ),
      ).finally(() => server.stop(true))
      expect(registrations[0]).toMatchObject({
        redirect_uris: [`http://127.0.0.1:${sent.port}/callback`, `http://localhost:${sent.port}/callback`],
      })
      expect(tokenRequests[0]?.get("redirect_uri")).toBe(`http://localhost:${sent.port}/callback`)
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

// Each instance has its own database connection, in-process lock table and file lock client over one
// database file, the way the TUI, desktop app and background service share credentials.
describe("MCP OAuth connections", () => {
  const id = Credential.ID.make("cred_test")

  // Each instance has its own database connection, in-process lock table and file lock client over one file,
  // like two OpenCode processes sharing a database.
  const instance = (file: string) =>
    ManagedRuntime.make(
      AppNodeBuilder.build(Credential.node, [Database.node.replace(Database.configured({ path: file }))]),
    )

  const setup = async (
    url: string,
    input: { expires?: number; metadata?: Record<string, unknown>; config?: typeof ConfigMCP.Remote.Type } = {},
  ) => {
    const tmp = await tmpdir()
    const file = path.join(tmp.path, "opencode.db")
    const first = instance(file)
    const second = instance(file)
    const row = credential({ access: "a1", refresh: "r1", url, expires: input.expires ?? Date.now() + 3_600_000 })
    await first.runPromise(
      Credential.Service.use((credentials) =>
        credentials.create({
          ...row,
          value: { ...row.value, metadata: { ...row.value.metadata, ...input.metadata } },
        }),
      ),
    )
    const config = input.config ?? remote(url)
    const provider = (runtime: ReturnType<typeof instance>) =>
      runtime.runPromise(
        Credential.Service.use((credentials) =>
          credentials
            .get(id)
            .pipe(Effect.flatMap((credential) => McpOAuth.connectProvider({ server: "test", config, credential }))),
        ),
      )
    return {
      first,
      second,
      provider,
      async [Symbol.asyncDispose]() {
        await Promise.all([first.dispose(), second.dispose()])
        await tmp[Symbol.asyncDispose]()
      },
    }
  }

  const stored = async (runtime: ReturnType<typeof instance>) => {
    const value = (await runtime.runPromise(Credential.Service.use((credentials) => credentials.get(id))))?.value
    return value?.type === "oauth" ? { access: value.access, refresh: value.refresh } : undefined
  }

  const unauthorized = (provider: AuthProvider, url: string, response = new Response(null, { status: 401 })) =>
    provider.onUnauthorized?.({ response, serverUrl: new URL(url), fetchFn: fetch })

  const connect = (provider: AuthProvider, url: string, config = remote(url)) =>
    Effect.runPromise(
      Effect.scoped(
        McpClient.connect({ server: "test", config, directory: import.meta.dir, authProvider: provider }),
      ).pipe(Effect.provide(hostEnvironmentLayer), Effect.exit),
    )

  const failure = (exit: Awaited<ReturnType<typeof connect>>) => Exit.isFailure(exit) && Cause.squash(exit.cause)

  // A server whose MCP endpoint accepts only the refreshed token and whose token endpoint the test switches.
  const guardedServer = () => {
    const state = {
      token: "ok" as "ok" | "unavailable" | "invalid_grant",
      tokenEndpoint: undefined as string | undefined,
      sent: [] as Array<string | null>,
      refused: 0,
    }
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/.well-known/oauth-authorization-server")
          return Response.json({
            issuer: url.origin,
            authorization_endpoint: `${url.origin}/authorize`,
            token_endpoint: state.tokenEndpoint ?? `${url.origin}/token`,
            response_types_supported: ["code"],
          })
        if (request.method === "POST" && url.pathname === "/token") {
          state.sent.push(new URLSearchParams(await request.text()).get("refresh_token"))
          if (state.token === "unavailable") return new Response("upstream unavailable", { status: 503 })
          if (state.token === "invalid_grant") return Response.json({ error: "invalid_grant" }, { status: 400 })
          return Response.json({ access_token: "a2", token_type: "Bearer", refresh_token: "r2", expires_in: 3600 })
        }
        if (request.method === "POST" && url.pathname === "/mcp") {
          if (request.headers.get("authorization") !== "Bearer a2") {
            state.refused++
            return new Response(null, { status: 401 })
          }
          const body = (await request.json()) as { id: number; method: string; params?: { protocolVersion?: string } }
          if (body.method !== "initialize") return new Response(null, { status: 202 })
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: body.params?.protocolVersion,
              capabilities: {},
              serverInfo: { name: "test", version: "1" },
            },
          })
        }
        return new Response(null, { status: 404 })
      },
    })
    return { server, state, url: `${server.url.origin}/mcp` }
  }

  test("refreshes a refused token and retries with the new one", async () => {
    const guarded = guardedServer()
    await using processes = await setup(guarded.url)

    const exit = await connect(await processes.provider(processes.first), guarded.url).finally(() =>
      guarded.server.stop(true),
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(guarded.state.sent).toEqual(["r1"])
    const value = (await processes.second.runPromise(Credential.Service.use((credentials) => credentials.get(id))))
      ?.value
    expect(value?.type === "oauth" && [value.access, value.refresh, value.metadata?.issuer]).toEqual([
      "a2",
      "r2",
      guarded.server.url.origin,
    ])
  })

  describe("ahead of expiry", () => {
    // An authorization server whose token endpoint the test switches, and the discovery a login saves for it.
    const issuerServer = () => {
      const state = { token: "ok" as "ok" | "unavailable", sent: [] as string[] }
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === "/.well-known/oauth-authorization-server/as")
            return Response.json({
              issuer: `${url.origin}/as`,
              authorization_endpoint: `${url.origin}/as/authorize`,
              token_endpoint: `${url.origin}/as/token`,
              response_types_supported: ["code"],
            })
          if (request.method !== "POST" || url.pathname !== "/as/token") return new Response(null, { status: 404 })
          state.sent.push(`${new URLSearchParams(await request.text()).get("resource")}`)
          if (state.token === "unavailable") return new Response(null, { status: 503 })
          return Response.json({ access_token: "a2", token_type: "Bearer", refresh_token: "r2", expires_in: 3600 })
        },
      })
      const origin = server.url.origin
      const discovery = { authorizationServer: `${origin}/as`, resource: `${origin}/mcp` }
      return { server, state, url: `${origin}/mcp`, discovery }
    }

    test("refreshes a token that expires within 30 seconds with the saved discovery before sending it", async () => {
      const as = issuerServer()
      await using processes = await setup(as.url, {
        expires: Date.now() + 10_000,
        metadata: { discovery: as.discovery },
      })

      const token = await (await processes.provider(processes.first)).token().finally(() => as.server.stop(true))

      expect(token).toBe("a2")
      // The saved discovery names the authorization server and resource; the MCP server is never probed.
      expect(as.state.sent).toEqual([as.url])
      expect(await stored(processes.second)).toEqual({ access: "a2", refresh: "r2" })
    })

    test("sends the current token when the refresh fails", async () => {
      const as = issuerServer()
      as.state.token = "unavailable"
      await using processes = await setup(as.url, {
        expires: Date.now() + 10_000,
        metadata: { discovery: as.discovery },
      })

      const token = await (await processes.provider(processes.first)).token().finally(() => as.server.stop(true))

      expect(token).toBe("a1")
      expect(await stored(processes.second)).toEqual({ access: "a1", refresh: "r1" })
    })

    test("leaves tokens with time left, without a lifetime, or saved without discovery to the 401", async () => {
      const as = issuerServer()
      const cases = [
        { expires: Date.now() + 60_000, metadata: { discovery: as.discovery } },
        { expires: 0, metadata: { discovery: as.discovery } },
        { expires: Date.now() + 10_000 },
      ]
      for (const input of cases) {
        await using processes = await setup(as.url, input)
        expect(await (await processes.provider(processes.first)).token()).toBe("a1")
      }
      as.server.stop(true)
      expect(as.state.sent).toEqual([])
    })
  })

  test("refreshes the credential it was made with, not the one signed in since", async () => {
    const guarded = guardedServer()
    await using processes = await setup(guarded.url)
    const provider = await processes.provider(processes.first)
    const newer = await processes.first.runPromise(
      Credential.Service.use((credentials) =>
        credentials.create({
          integrationID,
          value: credential({ access: "other", refresh: "other-refresh", url: guarded.url }).value,
        }),
      ),
    )

    await provider.token()
    await unauthorized(provider, guarded.url)?.finally(() => guarded.server.stop(true))

    expect(guarded.state.sent).toEqual(["r1"])
    expect(await stored(processes.second)).toEqual({ access: "a2", refresh: "r2" })
    const untouched = (
      await processes.second.runPromise(Credential.Service.use((credentials) => credentials.get(newer.id)))
    )?.value
    expect(untouched?.type === "oauth" && untouched.access).toBe("other")
  })

  test("reports needs_auth for an unauthorized server without a credential or any OAuth request", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(url.pathname)
        if (url.pathname === "/mcp") return new Response(null, { status: 401 })
        return new Response(null, { status: 404 })
      },
    })
    const url = `${server.url.origin}/mcp`
    const provider = await Effect.runPromise(
      McpOAuth.connectProvider({ server: "test", config: remote(url), credential: undefined }).pipe(
        Effect.provideService(Credential.Service, memoryCredentials([]).service),
      ),
    )

    const exit = await connect(provider, url).finally(() => server.stop(true))

    expect(failure(exit)).toBeInstanceOf(McpClient.NeedsAuthError)
    expect(requests.every((path) => path === "/mcp")).toBe(true)
  })

  describe("resource", () => {
    test("sends the configured URL when the server publishes no metadata", async () => {
      const { server, tokenRequests } = authorizationServer({})
      const url = `${server.url.origin}/mcp`
      await using processes = await setup(url)
      const provider = await processes.provider(processes.first)

      await provider.token()
      await unauthorized(provider, url)?.finally(() => server.stop(true))

      expect(tokenRequests[0]?.get("grant_type")).toBe("refresh_token")
      expect(tokenRequests[0]?.get("resource")).toBe(url)
    })

    test("keeps the configured URL when metadata echoes the dialed query", async () => {
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
      await using processes = await setup(url)
      const provider = await processes.provider(processes.first)

      // The transport dials with ?codemode=false and the 401 points at metadata that echoes it.
      await provider.token()
      await unauthorized(
        provider,
        `${url}?codemode=false`,
        new Response(null, {
          status: 401,
          headers: {
            "WWW-Authenticate": `Bearer resource_metadata="${server.url.origin}/.well-known/oauth-protected-resource/mcp?codemode=false"`,
          },
        }),
      )?.finally(() => server.stop(true))

      expect(tokenRequests[0]?.get("resource")).toBe(url)
    })

    test("discovers the resource for a login saved without one", async () => {
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
            return Response.json({ resource: `${url.origin}/`, authorization_servers: [url.origin] })
          if (request.method === "POST" && url.pathname === "/token") {
            tokenRequests.push(new URLSearchParams(await request.text()))
            return Response.json({ access_token: "a2", token_type: "Bearer" })
          }
          return new Response(null, { status: 404 })
        },
      })
      const url = `${server.url.origin}/mcp`
      await using processes = await setup(url)
      const provider = await processes.provider(processes.first)

      await provider.token()
      await unauthorized(provider, url)?.finally(() => server.stop(true))

      expect(tokenRequests[0]?.get("resource")).toBe(`${server.url.origin}/`)
    })

    test("follows the 401 to the resource for a login saved without discovery, and saves it", async () => {
      const tokenRequests: URLSearchParams[] = []
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === "/custom/metadata")
            return Response.json({ resource: `${url.origin}/`, authorization_servers: [`${url.origin}/as`] })
          if (url.pathname === "/.well-known/oauth-authorization-server/as")
            return Response.json({
              issuer: `${url.origin}/as`,
              authorization_endpoint: `${url.origin}/as/authorize`,
              token_endpoint: `${url.origin}/as/token`,
              response_types_supported: ["code"],
            })
          if (request.method === "POST" && url.pathname === "/as/token") {
            tokenRequests.push(new URLSearchParams(await request.text()))
            return Response.json({ access_token: "a2", token_type: "Bearer", refresh_token: "r2", expires_in: 3600 })
          }
          return new Response(null, { status: 404 })
        },
      })
      const url = `${server.url.origin}/mcp`
      await using processes = await setup(url, { expires: Date.now() - 1_000 })
      const provider = await processes.provider(processes.first)

      await provider.token()
      await unauthorized(
        provider,
        url,
        new Response(null, {
          status: 401,
          headers: { "WWW-Authenticate": `Bearer resource_metadata="${server.url.origin}/custom/metadata"` },
        }),
      )?.finally(() => server.stop(true))

      expect(tokenRequests.map((body) => body.get("resource"))).toEqual([`${server.url.origin}/`])
      const value = (await processes.second.runPromise(Credential.Service.use((credentials) => credentials.get(id))))
        ?.value
      expect(value?.type === "oauth" && value.metadata?.discovery).toEqual({
        authorizationServer: `${server.url.origin}/as`,
        resource: `${server.url.origin}/`,
      })
    })

    test("refreshes through configured authorization server metadata", async () => {
      const { server, tokenRequests } = authorizationServer({})
      const resource = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) })
      const url = `${resource.url.origin}/mcp`
      await using processes = await setup(url, {
        config: new ConfigMCP.Remote({
          type: "remote",
          url,
          oauth: {
            client_id: "client",
            auth_server_metadata_url: `${server.url.origin}/.well-known/oauth-authorization-server`,
          },
        }),
      })
      const provider = await processes.provider(processes.first)

      await provider.token()
      await unauthorized(provider, url)?.finally(() => {
        resource.stop(true)
        server.stop(true)
      })

      expect(tokenRequests[0]?.get("grant_type")).toBe("refresh_token")
      expect(tokenRequests[0]?.get("resource")).toBe(url)
    })
  })

  describe("across processes", () => {
    // A token endpoint that rotates refresh tokens and rejects reuse. The test releases each response.
    const rotatingServer = () => {
      const state = { current: "r1", generation: 1 }
      const sent: string[] = []
      const received = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          if (request.method !== "POST" || url.pathname !== "/token") return new Response(null, { status: 404 })
          const token = new URLSearchParams(await request.text()).get("refresh_token") ?? ""
          sent.push(token)
          received.resolve()
          await release.promise
          if (token !== state.current) return Response.json({ error: "invalid_grant" }, { status: 400 })
          state.generation++
          state.current = `r${state.generation}`
          return Response.json({
            access_token: `a${state.generation}`,
            token_type: "Bearer",
            refresh_token: state.current,
            expires_in: 3600,
          })
        },
      })
      return { server, sent, received: received.promise, release: () => release.resolve() }
    }

    test("sends one refresh when two instances refresh the same credential at once", async () => {
      const endpoint = rotatingServer()
      const url = endpoint.server.url.href
      await using processes = await setup(url)
      const [first, second] = await Promise.all([
        processes.provider(processes.first),
        processes.provider(processes.second),
      ])
      await Promise.all([first.token(), second.token()])

      const pending = unauthorized(first, url)
      // The first instance holds the credential lock until its rotated tokens are saved.
      await endpoint.received
      const waiting = unauthorized(second, url)
      endpoint.release()
      await Promise.all([pending, waiting]).finally(() => endpoint.server.stop(true))

      expect(endpoint.sent).toEqual(["r1"])
      expect([await first.token(), await second.token()]).toEqual(["a2", "a2"])
      expect(await stored(processes.second)).toEqual({ access: "a2", refresh: "r2" })
    })

    test("uses the stored tokens instead of spending a refresh token another instance already spent", async () => {
      const endpoint = rotatingServer()
      endpoint.release()
      const url = endpoint.server.url.href
      await using processes = await setup(url)
      const stale = await processes.provider(processes.first)
      const other = await processes.provider(processes.second)
      await Promise.all([stale.token(), other.token()])
      await unauthorized(other, url)

      await unauthorized(stale, url)?.finally(() => endpoint.server.stop(true))

      expect(endpoint.sent).toEqual(["r1"])
      expect(await stale.token()).toBe("a2")
    })

    test("needs auth without a request when the credential was signed out", async () => {
      const endpoint = rotatingServer()
      endpoint.release()
      const url = endpoint.server.url.href
      await using processes = await setup(url)
      const provider = await processes.provider(processes.first)
      await provider.token()
      await processes.second.runPromise(Credential.Service.use((credentials) => credentials.remove(id)))

      const error = await Promise.resolve(unauthorized(provider, url))
        .catch((error: unknown) => error)
        .finally(() => endpoint.server.stop(true))

      expect(error).toBeInstanceOf(UnauthorizedError)
      expect(endpoint.sent).toEqual([])
    })
  })

  describe("when the refresh fails", () => {
    test("fails without signing out when the token endpoint answers 503", async () => {
      const guarded = guardedServer()
      await using processes = await setup(guarded.url)
      guarded.state.token = "unavailable"

      const failed = failure(await connect(await processes.provider(processes.first), guarded.url))
      expect(failed).toBeInstanceOf(McpClient.ConnectError)
      expect(failed instanceof McpClient.ConnectError && failed.answered).toBe(false)
      expect(failed instanceof McpClient.ConnectError && failed.message).toBe(
        "Could not refresh the OAuth token: HTTP 503 (temporarily_unavailable)",
      )
      expect(await stored(processes.second)).toEqual({ access: "a1", refresh: "r1" })

      guarded.state.token = "ok"
      const exit = await connect(await processes.provider(processes.first), guarded.url).finally(() =>
        guarded.server.stop(true),
      )
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(guarded.state.sent).toEqual(["r1", "r1"])
      expect(await stored(processes.second)).toEqual({ access: "a2", refresh: "r2" })
    })

    test("fails without signing out when the token endpoint is unreachable", async () => {
      const guarded = guardedServer()
      const closed = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) })
      closed.stop(true)
      guarded.state.tokenEndpoint = `${closed.url.origin}/token`
      await using processes = await setup(guarded.url)

      const failed = failure(await connect(await processes.provider(processes.first), guarded.url))
      expect(failed).toBeInstanceOf(McpClient.ConnectError)
      expect(failed instanceof McpClient.ConnectError && failed.answered).toBe(false)
      expect(await stored(processes.second)).toEqual({ access: "a1", refresh: "r1" })

      guarded.state.tokenEndpoint = undefined
      const exit = await connect(await processes.provider(processes.first), guarded.url).finally(() =>
        guarded.server.stop(true),
      )
      expect(Exit.isSuccess(exit)).toBe(true)
    })

    test("signs out when the token endpoint answers invalid_grant", async () => {
      const guarded = guardedServer()
      guarded.state.token = "invalid_grant"
      await using processes = await setup(guarded.url)

      const failed = failure(await connect(await processes.provider(processes.first), guarded.url))
      guarded.server.stop(true)
      expect(failed).toBeInstanceOf(McpClient.NeedsAuthError)
      expect(await stored(processes.second)).toBeUndefined()
    })

    test("keeps the credential when the refresh times out", async () => {
      const received = Promise.withResolvers<void>()
      let aborted = false
      const hung = Bun.serve({
        port: 0,
        fetch: (request) => {
          request.signal.addEventListener("abort", () => {
            aborted = true
          })
          received.resolve()
          return new Promise<Response>(() => {})
        },
      })
      const url = hung.url.href
      await using processes = await setup(url)

      const error = await processes.first
        .runPromise(
          Effect.gen(function* () {
            const credentials = yield* Credential.Service
            const provider = yield* McpOAuth.connectProvider({
              server: "test",
              config: remote(url),
              credential: yield* credentials.get(id),
            })
            yield* Effect.promise(() => provider.token())
            const pending = Promise.resolve(unauthorized(provider, url)).catch((error: unknown) => error)
            yield* Effect.promise(() => received.promise)
            yield* TestClock.adjust("30 seconds")
            return yield* Effect.promise(() => pending)
          }).pipe(Effect.provide(TestClock.layer())),
        )
        .finally(() => hung.stop(true))

      expect(error instanceof OAuthError && error.code).toBe("temporarily_unavailable")
      expect(await stored(processes.second)).toEqual({ access: "a1", refresh: "r1" })
      expect(aborted).toBe(true)
    })

    test("sends nothing to an authorization server other than the one that issued the credential", async () => {
      const received: string[] = []
      const attacker = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === "/resource")
            return Response.json({ resource: `${url.origin}/`, authorization_servers: [url.origin] })
          if (url.pathname === "/.well-known/oauth-authorization-server")
            return Response.json({
              issuer: url.origin,
              authorization_endpoint: `${url.origin}/authorize`,
              token_endpoint: `${url.origin}/token`,
              response_types_supported: ["code"],
            })
          if (request.method === "POST") received.push(await request.text())
          return Response.json({ access_token: "stolen", token_type: "Bearer" })
        },
      })
      const url = `${attacker.url.origin}/mcp`
      // Saved before discovery was stored: only the issuer the login found is known.
      await using processes = await setup(url, { metadata: { issuer: "https://auth.legit.example" } })
      const provider = await processes.provider(processes.first)

      await provider.token()
      const error = await Promise.resolve(
        unauthorized(
          provider,
          url,
          new Response(null, {
            status: 401,
            headers: { "WWW-Authenticate": `Bearer resource_metadata="${attacker.url.origin}/resource"` },
          }),
        ),
      )
        .catch((error: unknown) => error)
        .finally(() => attacker.stop(true))

      expect(error).toBeInstanceOf(UnauthorizedError)
      expect(received).toEqual([])
      const value = (await processes.second.runPromise(Credential.Service.use((credentials) => credentials.get(id))))
        ?.value
      expect(value?.type === "oauth" && [value.access, value.refresh, value.metadata?.issuer]).toEqual([
        "a1",
        "r1",
        "https://auth.legit.example",
      ])
    })

    test("names only the error code of a token endpoint that answers without an OAuth error", async () => {
      const guarded = guardedServer()
      await using processes = await setup(guarded.url)
      const provider = await processes.provider(processes.first)
      const server = Bun.serve({
        port: 0,
        fetch: () => new Response("<html>secret echo of the request</html>", { status: 400 }),
      })
      guarded.state.tokenEndpoint = `${server.url.origin}/token`

      await provider.token()
      const error = await Promise.resolve(unauthorized(provider, guarded.url))
        .catch((error: unknown) => error)
        .finally(() => {
          server.stop(true)
          guarded.server.stop(true)
        })

      expect(error instanceof OAuthError && error.message).toBe("Could not refresh the OAuth token: server_error")
      expect(await stored(processes.second)).toEqual({ access: "a1", refresh: "r1" })
    })

    test("signs out a credential without client information", async () => {
      const { server, tokenRequests } = authorizationServer({})
      const url = `${server.url.origin}/mcp`
      await using processes = await setup(url, { config: new ConfigMCP.Remote({ type: "remote", url }) })
      const provider = await processes.provider(processes.first)

      await provider.token()
      const error = await Promise.resolve(unauthorized(provider, url))
        .catch((error: unknown) => error)
        .finally(() => server.stop(true))

      expect(error).toBeInstanceOf(UnauthorizedError)
      expect(tokenRequests).toEqual([])
      expect(await stored(processes.second)).toBeUndefined()
    })

    test("tries the next metadata URL when one answers 502", async () => {
      const tokenRequests: string[] = []
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === "/.well-known/oauth-authorization-server") return new Response(null, { status: 502 })
          if (url.pathname === "/.well-known/openid-configuration")
            return Response.json({
              issuer: url.origin,
              authorization_endpoint: `${url.origin}/authorize`,
              token_endpoint: `${url.origin}/token`,
              response_types_supported: ["code"],
              subject_types_supported: ["public"],
              id_token_signing_alg_values_supported: ["RS256"],
              jwks_uri: `${url.origin}/jwks`,
            })
          if (request.method === "POST" && url.pathname === "/token") {
            tokenRequests.push(url.pathname)
            return Response.json({ access_token: "a2", token_type: "Bearer", refresh_token: "r2" })
          }
          return new Response(null, { status: 404 })
        },
      })
      const url = `${server.url.origin}/mcp`
      await using processes = await setup(url)
      const provider = await processes.provider(processes.first)

      await provider.token()
      await unauthorized(provider, url)?.finally(() => server.stop(true))

      expect(tokenRequests).toEqual(["/token"])
      expect(await stored(processes.second)).toEqual({ access: "a2", refresh: "r2" })
    })
  })

  test("reports needs_auth when the server asks for more scope", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(null, {
          status: 403,
          headers: { "WWW-Authenticate": 'Bearer error="insufficient_scope", scope="admin"' },
        }),
    })
    const url = `${server.url.origin}/mcp`
    await using processes = await setup(url)

    const exit = await connect(await processes.provider(processes.first), url).finally(() => server.stop(true))

    expect(failure(exit)).toBeInstanceOf(McpClient.NeedsAuthError)
  })
})
