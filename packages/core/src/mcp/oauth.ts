export * as McpOAuth from "./oauth.js"

import {
  auth,
  LATEST_PROTOCOL_VERSION,
  checkResourceAllowed,
  discoverAuthorizationServerMetadata,
  discoverOAuthServerInfo,
  extractWWWAuthenticateParams,
  OAuthError,
  OAuthErrorCode,
  parseErrorResponse,
  refreshAuthorization,
  resourceUrlFromServerUrl,
  UnauthorizedError,
  type AuthProvider,
  type FetchLike,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client"
import { OAuthMetadataSchema, OpenIdProviderDiscoveryMetadataSchema } from "@modelcontextprotocol/core"
import { Cause, Clock, Data, Deferred, Duration, Effect, Option, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import type { ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Credential } from "../credential.js"
import { OauthCallbackPage } from "../oauth/page.js"
import { OauthRedirect } from "../oauth/redirect.js"
import type { Integration } from "../integration.js"
import { ErrorSummary } from "../util/error-summary.js"

/** Client ID Metadata Document: servers that support CIMD accept this URL as the client_id without registration. */
export const CLIENT_METADATA_URL = "https://opencode.ai/oauth/opencode/client.json"

// The authorization server refused the refresh token or the client: only a new login helps.
class RefreshRejected extends Data.TaggedError("McpOAuth.RefreshRejected")<{ readonly message: string }> {}

// Discovery named another authorization server than the one that issued the credential. Its tokens are not sent
// there; the credential stays for its own server, and a new login is needed meanwhile.
class IssuerChanged extends Data.TaggedError("McpOAuth.IssuerChanged")<{ readonly message: string }> {}

// Like other MCP clients: refreshing this close to expiry leaves short-lived tokens alone until they are due.
const REFRESH_AHEAD = Duration.seconds(30)

const rejections = new Set<string>([
  OAuthErrorCode.InvalidGrant,
  OAuthErrorCode.InvalidClient,
  OAuthErrorCode.UnauthorizedClient,
])

export const loggedFetch = (fields: { readonly server: string; readonly directory?: string }) =>
  Effect.gen(function* () {
    const run = Effect.runPromiseWith(yield* Effect.context())
    const fetch = yield* FetchHttpClient.Fetch
    // Bun's idle deadline is off because a tool call can stay silent for minutes; the MCP execution timeout still
    // applies. Requests use `FetchHttpClient.Fetch`, which an embedder can replace, rather than the global fetch.
    const send: FetchLike = (url, init) => fetch(url, { ...init, timeout: false } as BunFetchRequestInit)
    const request: FetchLike = (url, init) => {
      const grant = init?.body instanceof URLSearchParams ? init.body.get("grant_type") : undefined
      const operation = grant === "refresh_token" ? "refresh" : grant === "authorization_code" ? "exchange" : undefined
      const started = Date.now()
      return run(
        Effect.gen(function* () {
          if (operation) yield* Effect.logInfo("mcp oauth request started")
          const response = yield* Effect.tryPromise({ try: () => send(url, init), catch: (error) => error })
          const result = { status: response.status, durationMs: Date.now() - started }
          if (operation && !response.ok) {
            const error = yield* Effect.tryPromise(async () => parseErrorResponse(await response.clone().text())).pipe(
              Effect.orElseSucceed(() => undefined),
            )
            yield* Effect.logWarning("mcp oauth request rejected", {
              ...result,
              error: error?.code,
              message: error?.message,
            })
          }
          if (operation && response.ok) {
            yield* Effect.logInfo("mcp oauth request succeeded", result)
          }
          if (!operation && (response.status === 401 || response.status === 403)) {
            yield* Effect.logWarning("mcp http authentication rejected", result)
          }
          return response
        }).pipe(
          Effect.onError((cause) => {
            if (init?.signal?.aborted) return Effect.logDebug("mcp http request aborted")
            return Effect.logWarning("mcp http request failed", {
              errors: ErrorSummary.from(Cause.squash(cause)),
              durationMs: Date.now() - started,
            })
          }),
          Effect.annotateLogs({
            ...fields,
            requestID: crypto.randomUUID(),
            origin: new URL(url).origin,
            method: init?.method ?? "GET",
            ...(operation ? { operation } : {}),
          }),
        ),
      )
    }
    return request
  })

// A configured authorization server document stands in for RFC 9728 discovery: the SDK reuses this
// state instead of probing the resource server, whose well-known path may not exist.
const configuredDiscovery = async (input: {
  readonly config: typeof ConfigMCP.Remote.Type
  readonly fetchFn: FetchLike
}): Promise<OAuthDiscoveryState | undefined> => {
  const url = input.config.oauth ? input.config.oauth.auth_server_metadata_url : undefined
  if (!url) return undefined
  const response = await input.fetchFn(url, { headers: { accept: "application/json" } })
  if (!response.ok) throw new Error(`HTTP ${response.status} trying to load OAuth authorization server metadata`)
  const body = await response.json()
  const metadata = OAuthMetadataSchema.safeParse(body).data ?? OpenIdProviderDiscoveryMetadataSchema.parse(body)
  return {
    authorizationServerUrl: metadata.issuer,
    authorizationServerMetadata: metadata,
    resourceMetadata: { resource: resourceUrlFromServerUrl(input.config.url).toString() },
  }
}

interface Store {
  readonly tokens: () => Promise<StoredOAuthTokens | undefined>
  readonly saveTokens: (tokens: StoredOAuthTokens) => Promise<void>
  readonly clientInformation: () => Promise<StoredOAuthClientInformation | undefined>
  readonly saveClientInformation: (info: StoredOAuthClientInformation) => Promise<void>
  readonly codeVerifier: () => Promise<string | undefined>
  readonly saveCodeVerifier: (verifier: string) => Promise<void>
}

interface Options {
  readonly config: typeof ConfigMCP.Remote.Type
  readonly store: Store
  readonly redirect: {
    readonly url: () => string
    readonly registered: string[]
    readonly state: string
    readonly open: (url: URL) => void | Promise<void>
  }
  readonly clientMetadataUrl?: string
  readonly discovery: OAuthDiscoveryState
}

const provider = (options: Options): OAuthClientProvider => {
  const oauth = options.config.oauth || undefined
  const client = oauth?.client_id ? { client_id: oauth.client_id, client_secret: oauth.client_secret } : undefined
  const redirect = options.redirect
  let discovery = options.discovery
  return {
    get redirectUrl() {
      return redirect.url()
    },
    discoveryState: async () => discovery,
    saveDiscoveryState: (state) => {
      discovery = state
    },
    validateResourceURL: async (_serverUrl, resource) => selectResource(options.config, resource),
    ...(options.clientMetadataUrl ? { clientMetadataUrl: options.clientMetadataUrl } : {}),
    state: () => redirect.state,
    clientMetadata: {
      redirect_uris: redirect.registered,
      client_name: "opencode",
      client_uri: "https://opencode.ai",
      logo_uri: "https://opencode.ai/web-app-manifest-512x512.png",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: client?.client_secret ? "client_secret_post" : "none",
      ...(oauth?.scope ? { scope: oauth.scope } : {}),
    },
    clientInformation: async () => client ?? (await options.store.clientInformation()),
    saveClientInformation: (info) => options.store.saveClientInformation(info),
    tokens: () => options.store.tokens(),
    saveTokens: (tokens) => options.store.saveTokens(tokens),
    redirectToAuthorization: (url) => {
      if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new Error(
          `MCP server "${options.config.url}" returned a ${url.protocol} authorization URL; only http and https are supported`,
        )
      return redirect.open(url)
    },
    saveCodeVerifier: (verifier) => options.store.saveCodeVerifier(verifier),
    codeVerifier: async () => {
      const verifier = await options.store.codeVerifier()
      if (!verifier) throw new Error("Missing PKCE code verifier for MCP OAuth flow")
      return verifier
    },
  }
}

// The SDK sends no RFC 8707 resource when the server publishes no resource metadata; some
// authorization servers require one, so fall back to the configured URL.
const selectResource = (config: typeof ConfigMCP.Remote.Type, resource: string | undefined) => {
  const identity = new URL(config.url)
  identity.hash = ""
  if (!resource) return identity
  if (!checkResourceAllowed({ requestedResource: identity, configuredResource: resource }))
    throw new Error(`Protected resource ${resource} does not cover ${identity}`)
  const canonical = new URL(resource)
  // The transport dials the configured URL with extra query parameters and some servers echo
  // that back as the resource. Query is transport detail, not identity: the token stays bound
  // to the configured URL so a later refresh names the same resource the login did.
  if (canonical.origin === identity.origin && canonical.pathname === identity.pathname) return identity
  return canonical
}

const memoryStore = (): Store => {
  let tokens: StoredOAuthTokens | undefined
  let client: StoredOAuthClientInformation | undefined
  let verifier: string | undefined
  return {
    tokens: async () => tokens,
    saveTokens: async (value) => {
      tokens = value
    },
    clientInformation: async () => client,
    saveClientInformation: async (value) => {
      client = value
    },
    codeVerifier: async () => verifier,
    saveCodeVerifier: async (value) => {
      verifier = value
    },
  }
}

export const clientFromCredential = (credential: Credential.OAuth) =>
  credential.metadata?.client as StoredOAuthClientInformation | undefined

// Where the login found its authorization server and which resource it named, so a refresh need not discover them.
const Discovery = Schema.Struct({ authorizationServer: Schema.String, resource: Schema.String })
const decodeDiscovery = Schema.decodeUnknownOption(Discovery)
const discoveryFromCredential = (credential: Credential.OAuth) =>
  Option.getOrUndefined(decodeDiscovery(credential.metadata?.discovery))

const toCredential = (input: {
  readonly methodID: Integration.MethodID
  readonly serverUrl: string
  readonly tokens: StoredOAuthTokens
  readonly client: StoredOAuthClientInformation | undefined
  readonly discovery: typeof Discovery.Type | undefined
}) =>
  Credential.OAuth.make({
    type: "oauth",
    methodID: input.methodID,
    access: input.tokens.access_token,
    refresh: input.tokens.refresh_token ?? "",
    // 0 means the server gave no lifetime, so the token is only refreshed after a 401.
    expires: input.tokens.expires_in ? Date.now() + input.tokens.expires_in * 1000 : 0,
    metadata: {
      serverUrl: input.serverUrl,
      tokenType: input.tokens.token_type,
      ...(input.tokens.scope ? { scope: input.tokens.scope } : {}),
      ...(input.tokens.issuer ? { issuer: input.tokens.issuer } : {}),
      ...(input.discovery ? { discovery: input.discovery } : {}),
      ...(input.client ? { client: input.client } : {}),
    },
  })

/**
 * Bearer tokens for one credential the caller already selected, or none. It never looks up the active credential
 * itself: it reads and refreshes only the selected row, and one made without a credential stays anonymous. A
 * connection never starts a login, so a token the server refuses and cannot be refreshed ends in needs_auth.
 */
export const connectProvider = Effect.fnUntraced(function* (input: {
  readonly server: string
  readonly config: typeof ConfigMCP.Remote.Type
  readonly credential: Credential.Info | undefined
}): Effect.fn.Return<AuthProvider, never, Credential.Service> {
  const found = input.credential
  // Without onUnauthorized the transport answers a 401 with UnauthorizedError.
  if (found?.value.type !== "oauth") return { token: async () => undefined }
  const id = found.id
  const credentials = yield* Credential.Service
  const fetchFn = yield* loggedFetch({ server: input.server })
  const run = Effect.runPromiseWith(yield* Effect.context())
  const read = credentials.get(id).pipe(Effect.map((row) => (row?.value.type === "oauth" ? row.value : undefined)))
  const refresh = (stale: (current: Credential.OAuth, now: number) => boolean, resourceMetadataUrl?: URL) =>
    credentials.refresh(id, {
      stale,
      refresh: (current) =>
        exchange({ config: input.config, fetchFn, current, resourceMetadataUrl }).pipe(
          Effect.tapError((error) =>
            error instanceof RefreshRejected
              ? Effect.logWarning("mcp oauth credential invalidated", { credentialID: id, reason: error.message }).pipe(
                  Effect.andThen(credentials.remove(id)),
                )
              : Effect.void,
          ),
        ),
    })
  const due = (current: Credential.OAuth, now: number) => Credential.expiring(current, now, REFRESH_AHEAD)
  const refused = () => new UnauthorizedError(`MCP server "${input.config.url}" requires user authorization`)
  // The token last sent. A 401 refreshes only while the row still holds it: another connection or process may
  // have refreshed it already.
  let presented: string | undefined
  return {
    token: () =>
      run(
        Effect.gen(function* () {
          const current = yield* read
          // Refreshing ahead needs the discovery the login saved. If it fails, the current token goes out and a
          // 401 decides.
          const ahead =
            current?.refresh && discoveryFromCredential(current) && due(current, yield* Clock.currentTimeMillis)
          const value = ahead ? yield* refresh(due).pipe(Effect.orElseSucceed(() => current)) : current
          presented = value?.access
          return presented
        }),
      ),
    onUnauthorized: (context) =>
      run(
        Effect.gen(function* () {
          const rejected = presented
          if (!(yield* read)?.refresh) return yield* Effect.fail(refused())
          const value = yield* refresh(
            (current) => current.access === rejected,
            extractWWWAuthenticateParams(context.response).resourceMetadataUrl,
          ).pipe(
            Effect.catch((error) =>
              error instanceof RefreshRejected || error instanceof IssuerChanged
                ? Effect.fail(refused())
                : // Not a lost login: keep the credential and fail this attempt so the next one tries again. An OAuth
                  // error names only its code: its description can quote the server's whole response.
                  Effect.fail(
                    new OAuthError(
                      OAuthErrorCode.TemporarilyUnavailable,
                      `Could not refresh the OAuth token: ${
                        error instanceof OAuthError
                          ? error.code
                          : error instanceof Error
                            ? error.message
                            : String(error)
                      }`,
                    ),
                  ),
            ),
          )
          if (!value) return yield* Effect.fail(refused())
        }),
      ),
  }
})

// Refreshes with the discovery the login saved, or discovers as the login did and saves the result.
const exchange = (input: {
  readonly config: typeof ConfigMCP.Remote.Type
  readonly fetchFn: FetchLike
  readonly current: Credential.OAuth
  readonly resourceMetadataUrl: URL | undefined
}) =>
  Effect.tryPromise({
    try: async (signal) => {
      const fetchFn: FetchLike = async (url, init) => {
        const response = await input.fetchFn(url, { ...init, signal })
        // A failing token endpoint says nothing about the login; report its status, not its body.
        if (init?.method === "POST" && (response.status === 429 || response.status >= 500))
          throw new Error(`HTTP ${response.status}`)
        return response
      }
      const oauth = input.config.oauth || undefined
      const client = oauth?.client_id
        ? { client_id: oauth.client_id, client_secret: oauth.client_secret }
        : clientFromCredential(input.current)
      if (!client) throw new RefreshRejected({ message: "no OAuth client information" })
      const saved = discoveryFromCredential(input.current)
      const configured = await configuredDiscovery({ config: input.config, fetchFn })
      const server =
        configured ??
        (saved
          ? {
              authorizationServerUrl: saved.authorizationServer,
              authorizationServerMetadata: await discoverAuthorizationServerMetadata(saved.authorizationServer, {
                fetchFn,
              }),
              resourceMetadata: undefined,
            }
          : await discoverOAuthServerInfo(input.config.url, {
              resourceMetadataUrl: input.resourceMetadataUrl,
              fetchFn,
            }))
      const found = server.authorizationServerMetadata?.issuer ?? server.authorizationServerUrl
      const issuer = input.current.metadata?.issuer
      if (typeof issuer === "string" && found.replace(/\/$/, "") !== issuer.replace(/\/$/, ""))
        throw new IssuerChanged({ message: `issued by ${issuer}, but discovery names ${found}` })
      const resource = saved?.resource ?? selectResource(input.config, server.resourceMetadata?.resource).toString()
      const tokens = await refreshAuthorization(server.authorizationServerUrl, {
        metadata: server.authorizationServerMetadata,
        clientInformation: client,
        refreshToken: input.current.refresh,
        resource,
        fetchFn,
      })
      return toCredential({
        methodID: input.current.methodID,
        serverUrl: input.config.url,
        tokens: {
          refresh_token: input.current.refresh,
          ...tokens,
          issuer: found,
        },
        client: clientFromCredential(input.current),
        // A configured metadata URL is read on every refresh, so changing it applies at once.
        discovery: configured ? undefined : { authorizationServer: server.authorizationServerUrl, resource },
      })
    },
    catch: (error) =>
      error instanceof RefreshRejected || error instanceof IssuerChanged
        ? error
        : error instanceof OAuthError && rejections.has(error.code)
          ? new RefreshRejected({ message: error.message })
          : error,
  })

export const authorize = (input: {
  readonly name: string
  readonly config: typeof ConfigMCP.Remote.Type
  readonly integrationID: Integration.ID
  readonly methodID: Integration.MethodID
}) =>
  Effect.gen(function* () {
    const fields = { server: input.name, methodID: input.methodID, oauthAttemptID: crypto.randomUUID() }
    const context = yield* Effect.context()
    const run = Effect.runPromiseWith(context)
    const runFork = Effect.runForkWith(context)
    const credentials = yield* Credential.Service
    const fetchFn = yield* loggedFetch({ server: input.name }).pipe(Effect.annotateLogs(fields))
    yield* Effect.logInfo("mcp oauth authorization started", fields)
    const oauth = input.config.oauth || undefined
    const store = memoryStore()
    // Reuse the client registered by an earlier login; the SDK discards it if the issuer changed.
    const previous = (yield* credentials.list(input.integrationID)).at(-1)?.value
    if (previous?.type === "oauth") {
      const client = clientFromCredential(previous)
      if (client) yield* Effect.promise(() => store.saveClientInformation(client))
    }
    const code = yield* Deferred.make<
      { code: string; iss: string | undefined; host?: string; response?: ServerResponse },
      Error
    >()
    const redirect = oauth?.redirect_uri ? new URL(oauth.redirect_uri) : undefined
    const redirectPath = redirect?.pathname ?? "/callback"
    const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")

    // Lazy so runtimes without a loopback listener (workerd) never evaluate node:http.
    const { createServer } = yield* Effect.promise(() => import("node:http"))
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      if (url.pathname !== redirectPath) {
        response.writeHead(404).end("Not found")
        return
      }
      const fail = (reason: string, failure: string) => {
        runFork(Effect.logWarning("mcp oauth callback rejected", { ...fields, reason: failure }))
        Effect.runSync(Deferred.fail(code, new Error(reason)))
        response
          .writeHead(400, { "Content-Type": "text/html" })
          .end(OauthCallbackPage.error(reason, { provider: input.name }))
      }
      const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
      if (error) return fail(error, "authorization_error")
      const returned = url.searchParams.get("state")
      const value = url.searchParams.get("code")
      // Browsers can reach the callback without any OAuth parameters (preflights, prefetches, reloads). Only a
      // redirect from the authorization server may end the login, so keep waiting for it.
      if (returned === null && !value) {
        response
          .writeHead(400, { "Content-Type": "text/html" })
          .end(OauthCallbackPage.error("Missing authorization code", { provider: input.name }))
        return
      }
      if (returned !== state) return fail("OAuth state mismatch", "state_mismatch")
      if (!value) return fail("Missing authorization code", "missing_code")
      // The page waits for the token exchange so the browser never reports success for a rejected code.
      if (
        !Effect.runSync(
          Deferred.succeed(code, {
            code: value,
            iss: url.searchParams.get("iss") ?? undefined,
            host: request.headers.host,
            response,
          }),
        )
      )
        response.writeHead(409).end("OAuth callback already received")
    })

    // callback_port, else the port pinned by redirect_uri, else ephemeral; a mismatch strands the browser.
    const redirectPort = Number(redirect?.port) || undefined
    const port = yield* Effect.callback<number, Error>((resume) => {
      server.once("error", (error) => resume(Effect.fail(error)))
      server.listen(oauth?.callback_port ?? redirectPort ?? 0, "127.0.0.1", () => {
        resume(Effect.succeed((server.address() as AddressInfo).port))
      })
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => server.close()))

    // The server's 401 names where its resource metadata lives and which scopes it wants; without it
    // discovery can only guess the well-known path, which not every server layout answers.
    const challenge = yield* Effect.tryPromise((signal) =>
      fetchFn(input.config.url, {
        method: "POST",
        headers: {
          ...input.config.headers,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "opencode" } },
        }),
        signal,
      }),
    ).pipe(
      Effect.map((response) => extractWWWAuthenticateParams(response)),
      Effect.timeout("5 seconds"),
      Effect.orElseSucceed(() => ({ resourceMetadataUrl: undefined, scope: undefined })),
    )
    const resourceMetadataUrl = challenge.resourceMetadataUrl
    // CIMD needs the server to advertise it and accept public clients, and our published document only
    // lists the loopback redirect; a configured client_id always wins.
    const discovery = yield* Effect.tryPromise({
      try: async () =>
        (await configuredDiscovery({ config: input.config, fetchFn })) ??
        discoverOAuthServerInfo(input.config.url, { resourceMetadataUrl, fetchFn }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
    const cimd =
      !oauth?.client_id &&
      !oauth?.redirect_uri &&
      discovery.authorizationServerMetadata?.client_id_metadata_document_supported === true &&
      (discovery.authorizationServerMetadata.token_endpoint_auth_methods_supported?.includes("none") ?? false)
    yield* Effect.logInfo("mcp oauth client registration selected", {
      ...fields,
      registration: oauth?.client_id ? "static" : cimd ? "cimd" : "dcr",
    })

    // Some authorization servers (Clerk) rewrite a 127.0.0.1 redirect to localhost before sending the browser back,
    // and issue the code for the rewritten URI. Both are registered, and the token exchange repeats the one used.
    const loopback = (host: string) => `http://${host}:${port}${redirectPath}`
    let reached = "127.0.0.1"
    let authorizationUrl: URL | undefined
    const oauthProvider = provider({
      config: input.config,
      store,
      clientMetadataUrl: cimd ? CLIENT_METADATA_URL : undefined,
      discovery: { ...discovery, resourceMetadataUrl: resourceMetadataUrl?.toString() },
      redirect: {
        url: () => oauth?.redirect_uri ?? loopback(reached),
        registered: oauth?.redirect_uri ? [oauth.redirect_uri] : [loopback("127.0.0.1"), loopback("localhost")],
        state,
        open: (url) => {
          authorizationUrl = url
          return run(Effect.logInfo("mcp oauth awaiting authorization", fields))
        },
      },
    })

    const finalize = Effect.gen(function* () {
      const tokens = yield* Effect.promise(() => store.tokens())
      if (!tokens) return yield* Effect.fail(new Error(`MCP server "${input.name}" did not return OAuth tokens`))
      const client = yield* Effect.promise(() => store.clientInformation())
      yield* Effect.logInfo("mcp oauth authorization completed", {
        ...fields,
        hasRefreshToken: Boolean(tokens.refresh_token),
        expiresIn: tokens.expires_in,
      })
      return toCredential({
        methodID: input.methodID,
        serverUrl: input.config.url,
        tokens,
        client,
        discovery: oauth?.auth_server_metadata_url
          ? undefined
          : {
              authorizationServer: discovery.authorizationServerUrl,
              resource: selectResource(input.config, discovery.resourceMetadata?.resource).toString(),
            },
      })
    })

    yield* Effect.tryPromise({
      try: () => auth(oauthProvider, { serverUrl: input.config.url, scope: oauth?.scope ?? challenge.scope, fetchFn }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })

    if (!authorizationUrl)
      return yield* Effect.fail(new Error(`MCP server "${input.name}" did not provide an authorization URL`))

    const completed = yield* Deferred.make<Credential.OAuth, Error>()
    yield* Deferred.await(code).pipe(
      Effect.flatMap((value) => {
        if (value.host === `localhost:${port}`) reached = "localhost"
        const respond = (error?: string) =>
          Effect.sync(() =>
            value.response
              ?.writeHead(error ? 400 : 200, { "Content-Type": "text/html" })
              .end(
                error
                  ? OauthCallbackPage.error(error, { provider: input.name })
                  : OauthCallbackPage.success({ provider: input.name }),
              ),
          )
        return Effect.tryPromise({
          try: () =>
            auth(oauthProvider, {
              serverUrl: input.config.url,
              authorizationCode: value.code,
              iss: value.iss,
              scope: oauth?.scope ?? challenge.scope,
              fetchFn,
            }),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }).pipe(
          Effect.flatMap(() => finalize),
          Effect.tap(() => respond()),
          Effect.tapError((error) => respond(error.message)),
          Effect.onInterrupt(() => Effect.sync(() => value.response?.destroy())),
        )
      }),
      Effect.onErrorIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          Effect.logWarning("mcp oauth authorization failed", { errors: ErrorSummary.from(Cause.squash(cause)) }),
      ),
      Effect.annotateLogs(fields),
      Effect.exit,
      Effect.flatMap((exit) => Deferred.done(completed, exit)),
      Effect.forkScoped({ startImmediately: true }),
    )

    return {
      url: authorizationUrl.toString(),
      instructions: `Authorize ${input.name} in your browser. This window will close automatically.`,
      mode: "auto" as const,
      callback: Deferred.await(completed),
      // A pasted URL is held to the same checks as the browser's redirect, but a wrong paste keeps the login waiting.
      submit: (pasted: string) =>
        OauthRedirect.submit({
          state,
          callback: code,
          received: (value, params) => ({ code: value, iss: params.get("iss") ?? undefined }),
        })(pasted).pipe(Effect.tap(() => Effect.logInfo("mcp oauth redirect pasted", fields))),
    }
  }).pipe(
    Effect.onError((cause) =>
      Effect.logWarning("mcp oauth authorization setup failed", {
        server: input.name,
        methodID: input.methodID,
        errors: ErrorSummary.from(Cause.squash(cause)),
      }),
    ),
  )
