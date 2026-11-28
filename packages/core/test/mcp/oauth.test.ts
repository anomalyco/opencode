import { describe, expect, test } from "bun:test"
import path from "node:path"
import { OAuthError, UnauthorizedError, type AuthProvider } from "@modelcontextprotocol/client"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Integration } from "@opencode/core/integration"
import { McpClient } from "@opencode/core/mcp/client"
import { McpOAuth } from "@opencode/core/mcp/oauth"
import { McpTarget } from "@opencode/core/mcp/target"
import { Cause, Effect, Exit, ManagedRuntime, Result, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { hostEnvironmentLayer } from "../fixture/environment"
import { tmpdir } from "../fixture/tmpdir"

// OAuth against one configurable server playing the MCP endpoint, its protected resource metadata and its
// authorization server, each row one behavior the spec or a real server requires.

const integrationID = Integration.ID.make("mcp_test")
const methodID = Integration.MethodID.make("oauth")
const id = Credential.ID.make("cred_test")

interface Options {
  /** Where the resource publishes its metadata: in its 401's header, at a well-known path, or not at all. */
  readonly prm?: "header" | "well-known" | "path" | "none"
  /** What that metadata names as the resource, relative to the origin; `/mcp` by default. */
  readonly resource?: string
  /** The authorization server's path below the origin. */
  readonly as?: string
  /** What the authorization server calls itself, relative to the origin; its own URL by default. */
  readonly issuer?: string
  readonly metadata?: Record<string, unknown>
  /** Only a token of `a2` is accepted at /mcp; anything else gets a 401. */
  readonly guarded?: boolean
}

type TokenMode = "ok" | "unavailable" | "invalid_grant" | "invalid_client" | "hang" | "html"

const authServer = (options: Options = {}) => {
  const as = options.as ?? ""
  const state = {
    token: "ok" as TokenMode,
    tokenBody: { access_token: "a2", token_type: "Bearer", refresh_token: "r2", expires_in: 3600 } as Record<
      string,
      unknown
    >,
    issuer: options.issuer,
    tokenEndpoint: undefined as string | undefined,
    registrations: [] as unknown[],
    tokens: [] as URLSearchParams[],
    paths: [] as string[],
    aborted: false,
  }
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const origin = url.origin
      state.paths.push(url.pathname)
      const prm =
        options.prm === "header"
          ? "/prm"
          : options.prm === "path"
            ? "/.well-known/oauth-protected-resource/mcp"
            : options.prm === "well-known"
              ? "/.well-known/oauth-protected-resource"
              : undefined
      if (url.pathname === "/mcp") {
        if (options.guarded && request.headers.get("authorization") === "Bearer a2") return mcp(request)
        return new Response(null, {
          status: 401,
          headers: options.prm === "header" ? { "WWW-Authenticate": `Bearer resource_metadata="${origin}${prm}"` } : {},
        })
      }
      if (prm && url.pathname === prm)
        return Response.json({
          resource: `${origin}${options.resource ?? "/mcp"}${url.search}`,
          authorization_servers: [origin + as],
        })
      const metadata = {
        issuer: origin + (state.issuer ?? as),
        authorization_endpoint: `${origin}${as}/authorize`,
        token_endpoint: state.tokenEndpoint ?? `${origin}${as}/token`,
        registration_endpoint: `${origin}${as}/register`,
        response_types_supported: ["code"],
        ...options.metadata,
      }
      if (url.pathname === `/.well-known/oauth-authorization-server${as}`) return Response.json(metadata)
      if (request.method === "POST" && url.pathname === `${as}/register`) {
        state.registrations.push(await request.json())
        return Response.json({ client_id: "registered", redirect_uris: [] })
      }
      if (request.method === "POST" && url.pathname === `${as}/token`) {
        state.tokens.push(new URLSearchParams(await request.text()))
        if (state.token === "hang") {
          request.signal.addEventListener("abort", () => void (state.aborted = true))
          return new Promise<Response>(() => {})
        }
        if (state.token === "unavailable") return new Response("upstream unavailable", { status: 503 })
        if (state.token === "html") return new Response("<html>secret echo of the request</html>", { status: 400 })
        if (state.token !== "ok")
          return Response.json({ error: state.token, error_description: "bad_client_secret" }, { status: 400 })
        return Response.json(state.tokenBody)
      }
      return new Response(null, { status: 404 })
    },
  })
  return { server, state, origin: server.url.origin, url: `${server.url.origin}/mcp` }
}

// An MCP endpoint that only lets a refreshed token in.
async function mcp(request: Request) {
  if (request.method !== "POST") return new Response(null, { status: 405 })
  const body = (await request.json()) as { id: number; method: string; params?: { protocolVersion?: string } }
  if (body.method === "server/discover")
    return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } })
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

const target = (config: ConfigMCP.Remote) => Result.getOrThrow(McpTarget.remote("test", config))
const remote = (url: string, oauth?: ConfigMCP.OAuth) =>
  new ConfigMCP.Remote({ type: "remote", url, ...(oauth ? { oauth } : {}) })

const credential = (input: {
  access?: string
  refresh?: string
  expires?: number
  url: string
  metadata?: Record<string, unknown>
}) =>
  new Credential.Info({
    id,
    integrationID,
    label: "test",
    value: {
      type: "oauth",
      methodID,
      access: input.access ?? "a1",
      refresh: input.refresh ?? "r1",
      expires: input.expires ?? Date.now() + 3_600_000,
      metadata: { serverUrl: input.url, tokenType: "Bearer", ...input.metadata },
    },
  })

// Sign-in reads and writes the credential store; this one lives in memory.
const memoryCredentials = (initial: Credential.Info[] = []) => {
  const rows = new Map(initial.map((row) => [row.id, row]))
  const unused = () => Effect.die("unused credential method")
  return Credential.Service.of({
    refresh: unused,
    all: unused,
    create: unused,
    activate: unused,
    list: (integration) =>
      Effect.sync(() => Array.from(rows.values()).filter((row) => row.integrationID === integration)),
    get: (key) => Effect.sync(() => rows.get(key)),
    update: (key, updates) =>
      Effect.sync(() => {
        const row = rows.get(key)
        if (row) rows.set(key, new Credential.Info({ ...row, ...updates }))
      }),
    remove: (key) => Effect.sync(() => void rows.delete(key)),
  })
}

/** Starts a sign-in; the caller completes it through the loopback, a pasted URL, or not at all. */
const signIn = (url: string, oauth?: ConfigMCP.OAuth, store = memoryCredentials()) =>
  McpOAuth.authorize({ name: "test", target: target(remote(url, oauth)), integrationID, methodID }).pipe(
    Effect.map((authorization) => {
      const sent = new URL(authorization.url)
      // Where the browser lands after the user approves.
      const redirect = (code = "accepted", state = sent.searchParams.get("state") ?? "") => {
        const back = new URL(sent.searchParams.get("redirect_uri") ?? "")
        back.searchParams.set("code", code)
        back.searchParams.set("state", state)
        return back
      }
      return { authorization, sent, redirect }
    }),
    Effect.provideService(Credential.Service, store),
  )

type Server = ReturnType<typeof authServer>

const signIns: ReadonlyArray<{
  readonly name: string
  readonly server?: Options
  readonly run: (server: Server) => Effect.Effect<void, unknown, Scope.Scope>
}> = [
  {
    // Browsers reach the callback without OAuth parameters for preflights, prefetches and reloads.
    name: "completes through the loopback callback once, ignoring requests without OAuth parameters",
    run: (server) =>
      Effect.gen(function* () {
        const { authorization, redirect } = yield* signIn(server.origin + "/", { client_id: "client" })
        const bare = new URL(redirect().pathname, redirect().origin)
        expect((yield* Effect.promise(() => fetch(bare, { method: "OPTIONS" }))).status).toBe(400)
        expect((yield* Effect.promise(() => fetch(bare))).status).toBe(400)
        expect((yield* Effect.promise(() => fetch(redirect()))).status).toBe(200)
        expect((yield* Effect.promise(() => fetch(redirect()))).status).toBe(409)
        const result = yield* authorization.callback
        expect([result.access, result.refresh]).toEqual(["a2", "r2"])
        const exchange = server.state.tokens[0]
        expect([exchange?.get("grant_type"), exchange?.get("code"), exchange?.get("resource")]).toEqual([
          "authorization_code",
          "accepted",
          server.origin + "/",
        ])
        expect(exchange?.get("code_verifier")).not.toBeNull()
        expect(result.metadata?.discovery).toEqual({
          authorizationServer: server.origin + "/",
          resource: server.origin + "/",
        })
      }),
  },
  {
    name: "completes from a pasted redirect, and keeps waiting after a wrong paste",
    run: (server) =>
      Effect.gen(function* () {
        const { authorization, redirect } = yield* signIn(server.url, { client_id: "client" })
        expect((yield* Effect.flip(authorization.submit(redirect("pasted", "another-sign-in").href))).message).toBe(
          "This URL belongs to a different sign-in",
        )
        expect((yield* Effect.flip(authorization.submit("pasted"))).message).toBe(
          "Paste the full URL from the browser's address bar",
        )
        yield* authorization.submit(` ${redirect("pasted").href}\n`)
        expect((yield* authorization.callback).access).toBe("a2")
        expect(server.state.tokens.map((body) => body.get("code"))).toEqual(["pasted"])
      }),
  },
  {
    name: "shows a rejected token exchange on the callback page",
    run: (server) =>
      Effect.gen(function* () {
        server.state.token = "invalid_client"
        const { authorization, redirect } = yield* signIn(server.url, { client_id: "client" })
        const response = yield* Effect.promise(() => fetch(redirect()))
        expect(response.status).toBe(400)
        expect(yield* Effect.promise(() => response.text())).toContain("bad_client_secret")
        expect(Exit.isFailure(yield* Effect.exit(authorization.callback))).toBe(true)
      }),
  },
  {
    name: "listens on a loopback redirect, or the one configured",
    run: (server) =>
      Effect.gen(function* () {
        expect((yield* signIn(server.url, { client_id: "client" })).sent.searchParams.get("redirect_uri")).toMatch(
          /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
        )
        const free = Bun.serve({ port: 0, fetch: () => new Response() })
        const fixed = `http://127.0.0.1:${free.port}/fixed-callback`
        free.stop(true)
        expect(
          (yield* signIn(server.url, { client_id: "client", redirect_uri: fixed })).sent.searchParams.get(
            "redirect_uri",
          ),
        ).toBe(fixed)
      }),
  },
  {
    name: "refuses an authorization endpoint that is not http or https",
    server: { metadata: { authorization_endpoint: "file:///tmp/authorize" } },
    run: (server) =>
      Effect.gen(function* () {
        expect(String(yield* Effect.flip(signIn(server.url)))).toContain("returned a file: authorization URL")
      }),
  },
  {
    name: "follows the 401 to the resource metadata, and names the published resource rather than the configured query",
    server: { prm: "header", as: "/as" },
    run: (server) =>
      Effect.gen(function* () {
        const { authorization, sent, redirect } = yield* signIn(`${server.url}?oauth=initialize`, {
          client_id: "client",
        })
        expect(sent.pathname).toBe("/as/authorize")
        yield* Effect.promise(() => fetch(redirect()))
        const result = yield* authorization.callback
        expect([sent.searchParams.get("resource"), server.state.tokens[0]?.get("resource")]).toEqual([
          server.url,
          server.url,
        ])
        expect(result.metadata?.discovery).toEqual({ authorizationServer: `${server.origin}/as`, resource: server.url })
      }),
  },
  {
    name: "uses configured authorization server metadata when the resource publishes none",
    run: (server) =>
      Effect.gen(function* () {
        const resource = yield* Effect.acquireRelease(
          Effect.sync(() => Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) })),
          (resource) => Effect.sync(() => resource.stop(true)),
        )
        const url = `${resource.url.origin}/mcp`
        const { sent } = yield* signIn(url, {
          client_id: "client",
          auth_server_metadata_url: `${server.origin}/.well-known/oauth-authorization-server`,
        })
        expect([sent.origin, sent.pathname, sent.searchParams.get("resource")]).toEqual([
          server.origin,
          "/authorize",
          url,
        ])
      }),
  },
  {
    name: "asks for offline_access without forcing consent, and keeps the scope a token response leaves out (#58319)",
    server: { metadata: { scopes_supported: ["read", "offline_access"] } },
    run: (server) =>
      Effect.gen(function* () {
        server.state.tokenBody = { access_token: "a2", token_type: "Bearer" }
        const { authorization, sent, redirect } = yield* signIn(server.url, { client_id: "client", scope: "read" })
        expect([sent.searchParams.get("scope"), sent.searchParams.has("prompt")]).toEqual([
          "read offline_access",
          false,
        ])
        yield* Effect.promise(() => fetch(redirect()))
        expect((yield* authorization.callback).metadata?.scope).toBe("read offline_access")
      }),
  },
  {
    name: "accepts an issuer that adds a trailing slash, and nothing else (#50036)",
    server: { prm: "header", resource: "/mcp", issuer: "/" },
    run: (server) =>
      Effect.gen(function* () {
        expect((yield* signIn(server.url, { client_id: "client" })).sent.pathname).toBe("/authorize")
        server.state.issuer = "/other"
        expect(String(yield* Effect.flip(signIn(server.url, { client_id: "client" })))).toContain("Issuer mismatch")
      }),
  },
  {
    name: "asks Google for offline access so it issues a refresh token (#59820)",
    server: { metadata: { authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth" } },
    run: (server) =>
      Effect.gen(function* () {
        expect((yield* signIn(server.url, { client_id: "client" })).sent.searchParams.get("access_type")).toBe(
          "offline",
        )
      }),
  },
  {
    name: "forwards iss from the redirect to a server that advertises it",
    server: { metadata: { authorization_response_iss_parameter_supported: true } },
    run: (server) =>
      Effect.gen(function* () {
        const { authorization, redirect } = yield* signIn(server.url)
        const back = redirect()
        back.searchParams.set("iss", server.origin)
        yield* Effect.promise(() => fetch(back))
        expect((yield* authorization.callback).access).toBe("a2")
      }),
  },
  {
    name: "uses the client metadata document with a server that takes public CIMD clients",
    server: {
      metadata: { client_id_metadata_document_supported: true, token_endpoint_auth_methods_supported: ["none"] },
    },
    run: (server) =>
      Effect.gen(function* () {
        const { authorization, sent, redirect } = yield* signIn(server.url)
        expect(sent.searchParams.get("client_id")).toBe(McpOAuth.CLIENT_METADATA_URL)
        yield* Effect.promise(() => fetch(redirect()))
        const result = yield* authorization.callback
        expect(server.state.registrations).toEqual([])
        expect(server.state.tokens[0]?.get("client_id")).toBe(McpOAuth.CLIENT_METADATA_URL)
        expect(McpOAuth.clientFromCredential(result)).toEqual({
          client_id: McpOAuth.CLIENT_METADATA_URL,
          issuer: server.origin,
        })
        // A custom redirect_uri can't be in the published document, so the client registers.
        expect(
          (yield* signIn(server.url, { redirect_uri: "http://127.0.0.1:0/custom" })).sent.searchParams.get("client_id"),
        ).toBe("registered")
      }),
  },
  {
    name: "registers dynamically with a server that takes no public clients, redeeming with the redirect the browser used",
    server: {
      metadata: {
        client_id_metadata_document_supported: true,
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      },
    },
    run: (server) =>
      Effect.gen(function* () {
        const { authorization, sent, redirect } = yield* signIn(server.url)
        expect(sent.searchParams.get("client_id")).toBe("registered")
        const back = redirect()
        expect(server.state.registrations).toEqual([
          expect.objectContaining({
            client_name: "opencode",
            client_uri: "https://opencode.ai",
            logo_uri: "https://opencode.ai/web-app-manifest-512x512.png",
            redirect_uris: [`http://127.0.0.1:${back.port}/callback`, `http://localhost:${back.port}/callback`],
          }),
        ])
        // Clerk's consent page rewrites 127.0.0.1 to localhost; the browser reaches the same listener.
        yield* Effect.promise(() => fetch(back, { headers: { host: `localhost:${back.port}` } }))
        yield* authorization.callback
        expect(server.state.tokens[0]?.get("redirect_uri")).toBe(`http://localhost:${back.port}/callback`)
        // A pasted localhost redirect is redeemed with it too.
        const pasted = yield* signIn(server.url)
        const localhost = pasted.redirect()
        localhost.hostname = "localhost"
        yield* pasted.authorization.submit(localhost.href)
        yield* pasted.authorization.callback
        expect(server.state.tokens[1]?.get("redirect_uri")).toBe(`http://localhost:${localhost.port}/callback`)
      }),
  },
  {
    name: "reuses the client an earlier login registered, ignoring a corrupt one",
    run: (server) =>
      Effect.gen(function* () {
        const saved = (client: unknown) => memoryCredentials([credential({ url: server.url, metadata: { client } })])
        const reused = yield* signIn(server.url, undefined, saved({ client_id: "earlier", issuer: server.origin }))
        expect([reused.sent.searchParams.get("client_id"), server.state.registrations]).toEqual(["earlier", []])
        yield* signIn(server.url, undefined, saved("corrupt"))
        expect(server.state.registrations).toHaveLength(1)
      }),
  },
  {
    name: "signs in again on the port a registered client names, or registers again when it is taken (#62331)",
    run: (server) =>
      Effect.gen(function* () {
        const free = Bun.serve({ port: 0, fetch: () => new Response(null) })
        const port = free.port
        free.stop(true)
        const client = {
          client_id: "registered-before",
          redirect_uris: [`http://127.0.0.1:${port}/callback`, `http://localhost:${port}/callback`],
        }
        const store = () => memoryCredentials([credential({ url: "unused", expires: 0, metadata: { client } })])
        const port_ = (sent: URL) => new URL(sent.searchParams.get("redirect_uri") ?? "").port
        const reused = (yield* Effect.scoped(signIn(server.url, undefined, store()))).sent
        expect([port_(reused), reused.searchParams.get("client_id"), server.state.registrations]).toEqual([
          String(port),
          "registered-before",
          [],
        ])
        const holder = yield* Effect.acquireRelease(
          Effect.sync(() => Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response(null) })),
          (holder) => Effect.sync(() => holder.stop(true)),
        )
        void holder
        const registered = (yield* signIn(server.url, undefined, store())).sent
        expect(port_(registered)).not.toBe(String(port))
        expect([registered.searchParams.get("client_id"), server.state.registrations.length]).toEqual(["registered", 1])
      }),
  },
  {
    name: "stores the token expiry on the effect clock",
    run: (server) =>
      Effect.gen(function* () {
        server.state.tokenBody = { access_token: "a2", token_type: "Bearer", expires_in: 3600 }
        yield* TestClock.setTime(1_000)
        const { authorization, redirect } = yield* signIn(server.url, { client_id: "client" })
        yield* authorization.submit(redirect().href)
        expect((yield* authorization.callback).expires).toBe(1_000 + 3_600_000)
      }).pipe(Effect.provide(TestClock.layer())),
  },
]

describe("MCP OAuth sign-in", () => {
  for (const row of signIns)
    test(row.name, async () => {
      const server = authServer(row.server)
      await Effect.runPromise(Effect.scoped(row.run(server))).finally(() => server.server.stop(true))
    })
})

// Two instances over one database file, each with its own connection, lock table and file lock client, like two
// OpenCode processes sharing credentials.
const instance = (file: string) =>
  ManagedRuntime.make(
    AppNodeBuilder.build(Credential.node, [Database.node.replace(Database.configured({ path: file }))]),
  )
type Instance = ReturnType<typeof instance>

const processes = async (
  url: string,
  input: { expires?: number; metadata?: Record<string, unknown>; config?: ConfigMCP.Remote } = {},
) => {
  const tmp = await tmpdir()
  const file = path.join(tmp.path, "opencode.db")
  const first = instance(file)
  const second = instance(file)
  const row = credential({ url, expires: input.expires, metadata: input.metadata })
  await first.runPromise(Credential.Service.use((credentials) => credentials.create(row)))
  const config = input.config ?? remote(url, { client_id: "client" })
  return {
    first,
    second,
    provider: (runtime: Instance = first) =>
      runtime.runPromise(
        Credential.Service.use((credentials) =>
          credentials
            .get(id)
            .pipe(
              Effect.flatMap((saved) =>
                McpOAuth.connectProvider({ server: "test", target: target(config), credential: saved }),
              ),
            ),
        ),
      ),
    /** The credential as the other instance reads it. */
    stored: async () => {
      const value = (await second.runPromise(Credential.Service.use((credentials) => credentials.get(id))))?.value
      return value?.type === "oauth" ? value : undefined
    },
    create: (value: Credential.Info["value"]) =>
      first.runPromise(Credential.Service.use((credentials) => credentials.create({ integrationID, value }))),
    remove: () => second.runPromise(Credential.Service.use((credentials) => credentials.remove(id))),
    async [Symbol.asyncDispose]() {
      await Promise.all([first.dispose(), second.dispose()])
      await tmp[Symbol.asyncDispose]()
    },
  }
}

// Loads the provider's tokens, unless it already did, then hands it a 401 as the transport would.
const unauthorized = (provider: AuthProvider, url: string, header?: string, loaded = false) =>
  Promise.resolve(loaded ? undefined : provider.token())
    .then(() =>
      provider.onUnauthorized?.({
        response: new Response(null, { status: 401, headers: header ? { "WWW-Authenticate": header } : {} }),
        serverUrl: new URL(url),
        fetchFn: fetch,
      }),
    )
    .catch((error: unknown) => error)

const connect = (provider: AuthProvider, url: string, config = remote(url, { client_id: "client" })) =>
  Effect.runPromise(
    Effect.scoped(
      McpClient.connect({ server: "test", target: target(config), directory: import.meta.dir, authProvider: provider }),
    ).pipe(Effect.provide(hostEnvironmentLayer), Effect.exit),
  )
const failure = (exit: Awaited<ReturnType<typeof connect>>) => Exit.isFailure(exit) && Cause.squash(exit.cause)

type Processes = Awaited<ReturnType<typeof processes>>

const refreshes: ReadonlyArray<{
  readonly name: string
  readonly server?: Options
  /** The saved credential: when it expires, and what it remembers. */
  readonly saved?: (server: Server) => { expires?: number; metadata?: Record<string, unknown> }
  readonly config?: (server: Server) => ConfigMCP.Remote
  readonly run: (server: Server, saved: Processes) => Promise<void>
}> = [
  {
    name: "refreshes a token that expires within 30 seconds with the saved discovery and granted scope (#66175), without probing the server",
    server: { as: "/as" },
    saved: (server) => ({
      expires: Date.now() + 10_000,
      metadata: {
        scope: "api://app/.default offline_access",
        discovery: { authorizationServer: `${server.origin}/as`, resource: server.url },
      },
    }),
    run: async (server, saved) => {
      expect(await (await saved.provider()).token()).toBe("a2")
      expect(server.state.tokens.map((body) => [body.get("resource"), body.get("scope")])).toEqual([
        [server.url, "api://app/.default offline_access"],
      ])
      expect(server.state.paths).not.toContain("/mcp")
      expect((await saved.stored())?.access).toBe("a2")
    },
  },
  {
    name: "sends the current token when a refresh ahead of expiry fails",
    saved: (server) => ({
      expires: Date.now() + 10_000,
      metadata: { discovery: { authorizationServer: server.origin, resource: server.url } },
    }),
    run: async (server, saved) => {
      server.state.token = "unavailable"
      expect(await (await saved.provider()).token()).toBe("a1")
      expect((await saved.stored())?.access).toBe("a1")
    },
  },
  {
    name: "refreshes the credential it was made with, not one signed in since",
    server: { guarded: true },
    run: async (server, saved) => {
      const provider = await saved.provider()
      const newer = await saved.create(credential({ access: "other", refresh: "other-refresh", url: server.url }).value)
      await provider.token()
      await unauthorized(provider, server.url)
      expect(server.state.tokens.map((body) => body.get("refresh_token"))).toEqual(["r1"])
      expect([(await saved.stored())?.access]).toEqual(["a2"])
      const untouched = await saved.second.runPromise(
        Credential.Service.use((credentials) => credentials.get(newer.id)),
      )
      expect(untouched?.value.type === "oauth" && untouched.value.access).toBe("other")
    },
  },
  {
    name: "keeps the configured URL when the metadata echoes the dialed query",
    server: { prm: "path" },
    run: async (server, saved) => {
      // The transport dials with ?codemode=false and the 401 points at metadata that echoes it.
      await unauthorized(
        await saved.provider(),
        `${server.url}?codemode=false`,
        `Bearer resource_metadata="${server.origin}/.well-known/oauth-protected-resource/mcp?codemode=false"`,
      )
      expect(server.state.tokens[0]?.get("resource")).toBe(server.url)
    },
  },
  {
    name: "names the published resource on refresh when the configured URL has a query",
    server: { prm: "well-known" },
    config: (server) => remote(`${server.url}?oauth=initialize`, { client_id: "client" }),
    run: async (server, saved) => {
      await unauthorized(
        await saved.provider(),
        `${server.url}?oauth=initialize&codemode=false`,
        `Bearer resource_metadata="${server.origin}/.well-known/oauth-protected-resource"`,
      )
      expect(server.state.tokens[0]?.get("resource")).toBe(server.url)
    },
  },
  {
    name: "follows the 401 to the resource for a login saved without discovery, and saves it",
    server: { prm: "header", resource: "/", as: "/as" },
    saved: () => ({ expires: Date.now() - 1_000 }),
    run: async (server, saved) => {
      await unauthorized(await saved.provider(), server.url, `Bearer resource_metadata="${server.origin}/prm"`)
      expect(server.state.tokens.map((body) => body.get("resource"))).toEqual([`${server.origin}/`])
      expect((await saved.stored())?.metadata?.discovery).toEqual({
        authorizationServer: `${server.origin}/as`,
        resource: `${server.origin}/`,
      })
    },
  },
  {
    name: "refreshes through configured authorization server metadata",
    config: (server) =>
      remote(`${server.origin}/elsewhere`, {
        client_id: "client",
        auth_server_metadata_url: `${server.origin}/.well-known/oauth-authorization-server`,
      }),
    run: async (server, saved) => {
      await unauthorized(await saved.provider(), `${server.origin}/elsewhere`)
      expect([server.state.tokens[0]?.get("grant_type"), server.state.tokens[0]?.get("resource")]).toEqual([
        "refresh_token",
        `${server.origin}/elsewhere`,
      ])
    },
  },
  {
    name: "refreshes a refused token and retries with it, failing without signing out while the token endpoint answers 503",
    server: { guarded: true },
    run: async (server, saved) => {
      server.state.token = "unavailable"
      const failed = failure(await connect(await saved.provider(), server.url))
      expect(failed).toBeInstanceOf(McpClient.ConnectError)
      expect(failed instanceof McpClient.ConnectError && [failed.answered, failed.message]).toEqual([
        false,
        "Could not refresh the OAuth token: HTTP 503 (temporarily_unavailable)",
      ])
      expect((await saved.stored())?.access).toBe("a1")
      server.state.token = "ok"
      expect(Exit.isSuccess(await connect(await saved.provider(), server.url))).toBe(true)
      expect(server.state.tokens.map((body) => body.get("refresh_token"))).toEqual(["r1", "r1"])
      const value = await saved.stored()
      expect([value?.access, value?.refresh, value?.metadata?.issuer]).toEqual(["a2", "r2", server.origin])
    },
  },
  {
    name: "fails without signing out when the token endpoint is unreachable",
    server: { guarded: true },
    run: async (server, saved) => {
      const closed = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) })
      closed.stop(true)
      server.state.tokenEndpoint = `${closed.url.origin}/token`
      const failed = failure(await connect(await saved.provider(), server.url))
      expect(failed instanceof McpClient.ConnectError && failed.answered).toBe(false)
      expect((await saved.stored())?.access).toBe("a1")
      server.state.tokenEndpoint = undefined
      expect(Exit.isSuccess(await connect(await saved.provider(), server.url))).toBe(true)
    },
  },
  {
    name: "signs out when the token endpoint answers invalid_grant",
    server: { guarded: true },
    run: async (server, saved) => {
      server.state.token = "invalid_grant"
      expect(failure(await connect(await saved.provider(), server.url))).toBeInstanceOf(McpClient.NeedsAuthError)
      expect(await saved.stored()).toBeUndefined()
    },
  },
  {
    name: "signs out a credential without client information, without asking",
    config: (server) => remote(server.url),
    run: async (server, saved) => {
      expect(await unauthorized(await saved.provider(), server.url)).toBeInstanceOf(UnauthorizedError)
      expect(server.state.tokens).toEqual([])
      expect(await saved.stored()).toBeUndefined()
    },
  },
  {
    name: "names only the error code of a token endpoint that answers without an OAuth error",
    run: async (server, saved) => {
      server.state.token = "html"
      const error = await unauthorized(await saved.provider(), server.url)
      expect(error instanceof OAuthError && error.message).toBe("Could not refresh the OAuth token: server_error")
      expect((await saved.stored())?.access).toBe("a1")
    },
  },
  {
    name: "sends nothing to an authorization server other than the one that issued the credential",
    server: { prm: "header", resource: "/" },
    // Saved before discovery was stored: only the issuer the login found is known.
    saved: () => ({ metadata: { issuer: "https://auth.legit.example" } }),
    run: async (server, saved) => {
      const error = await unauthorized(
        await saved.provider(),
        server.url,
        `Bearer resource_metadata="${server.origin}/prm"`,
      )
      expect(error).toBeInstanceOf(UnauthorizedError)
      expect(server.state.tokens).toEqual([])
      const value = await saved.stored()
      expect([value?.access, value?.metadata?.issuer]).toEqual(["a1", "https://auth.legit.example"])
    },
  },
  {
    name: "keeps the credential when the refresh times out",
    run: async (server, saved) => {
      server.state.token = "hang"
      const error = await saved.first.runPromise(
        Effect.gen(function* () {
          const credentials = yield* Credential.Service
          const provider = yield* McpOAuth.connectProvider({
            server: "test",
            target: target(remote(server.url, { client_id: "client" })),
            credential: yield* credentials.get(id),
          })
          const pending = unauthorized(provider, server.url)
          while (server.state.tokens.length === 0) yield* Effect.promise(() => Bun.sleep(1))
          yield* TestClock.adjust("30 seconds")
          return yield* Effect.promise(() => pending)
        }).pipe(Effect.provide(TestClock.layer())),
      )
      expect(error instanceof OAuthError && error.code).toBe("temporarily_unavailable")
      expect((await saved.stored())?.access).toBe("a1")
      expect(server.state.aborted).toBe(true)
    },
  },
  {
    name: "needs a sign-in when the server asks for more scope",
    run: async (server, saved) => {
      const scoped = Bun.serve({
        port: 0,
        fetch: () =>
          new Response(null, {
            status: 403,
            headers: { "WWW-Authenticate": 'Bearer error="insufficient_scope", scope="admin"' },
          }),
      })
      const exit = await connect(await saved.provider(), `${scoped.url.origin}/mcp`).finally(() => scoped.stop(true))
      expect(failure(exit)).toBeInstanceOf(McpClient.NeedsAuthError)
      void server
    },
  },
]

describe("MCP OAuth refresh", () => {
  for (const row of refreshes)
    test(row.name, async () => {
      const server = authServer(row.server)
      await using saved = await processes(server.url, { ...row.saved?.(server), config: row.config?.(server) })
      await row.run(server, saved).finally(() => server.server.stop(true))
    })

  test("asks nothing of a server that refuses a connection with no credential", async () => {
    const server = authServer()
    const provider = await Effect.runPromise(
      McpOAuth.connectProvider({
        server: "test",
        target: target(remote(server.url, { client_id: "client" })),
        credential: undefined,
      }).pipe(Effect.provideService(Credential.Service, memoryCredentials())),
    )
    const exit = await connect(provider, server.url).finally(() => server.server.stop(true))
    expect(failure(exit)).toBeInstanceOf(McpClient.NeedsAuthError)
    expect(server.state.paths.every((item) => item === "/mcp")).toBe(true)
  })

  test("leaves tokens with time left, without a lifetime, or saved without discovery to the 401", async () => {
    const server = authServer()
    const discovery = { authorizationServer: server.origin, resource: server.url }
    for (const saved of [
      { expires: Date.now() + 60_000, metadata: { discovery } },
      { expires: 0, metadata: { discovery } },
      { expires: Date.now() + 10_000 },
    ]) {
      await using instances = await processes(server.url, saved)
      expect(await (await instances.provider()).token()).toBe("a1")
    }
    server.server.stop(true)
    expect(server.state.tokens).toEqual([])
  })
})

describe("MCP OAuth across processes", () => {
  // A token endpoint that rotates refresh tokens and rejects reuse. The test releases each response.
  const rotating = () => {
    const state = { current: "r1", generation: 1 }
    const sent: string[] = []
    const received = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        if (request.method !== "POST" || new URL(request.url).pathname !== "/token")
          return new Response(null, { status: 404 })
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
    return { server, url: server.url.href, sent, received: received.promise, release: () => release.resolve() }
  }

  test("sends one refresh when two instances refresh the same credential at once", async () => {
    const endpoint = rotating()
    await using saved = await processes(endpoint.url)
    const [first, second] = await Promise.all([saved.provider(saved.first), saved.provider(saved.second)])
    const pending = unauthorized(first, endpoint.url)
    // The first instance holds the credential lock until its rotated tokens are saved.
    await endpoint.received
    const waiting = unauthorized(second, endpoint.url)
    endpoint.release()
    await Promise.all([pending, waiting]).finally(() => endpoint.server.stop(true))
    expect(endpoint.sent).toEqual(["r1"])
    expect([await first.token(), await second.token()]).toEqual(["a2", "a2"])
    expect((await saved.stored())?.refresh).toBe("r2")
  })

  test("uses the stored tokens instead of spending a refresh token another instance already spent", async () => {
    const endpoint = rotating()
    endpoint.release()
    await using saved = await processes(endpoint.url)
    const stale = await saved.provider(saved.first)
    const other = await saved.provider(saved.second)
    // Loaded before the other instance spends the refresh token.
    await stale.token()
    await unauthorized(other, endpoint.url)
    await unauthorized(stale, endpoint.url, undefined, true).finally(() => endpoint.server.stop(true))
    expect(endpoint.sent).toEqual(["r1"])
    expect(await stale.token()).toBe("a2")
  })

  test("needs a sign-in, without a request, when another instance signed out", async () => {
    const endpoint = rotating()
    endpoint.release()
    await using saved = await processes(endpoint.url)
    const provider = await saved.provider()
    await saved.remove()
    expect(await unauthorized(provider, endpoint.url).finally(() => endpoint.server.stop(true))).toBeInstanceOf(
      UnauthorizedError,
    )
    expect(endpoint.sent).toEqual([])
  })
})
