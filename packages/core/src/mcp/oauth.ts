export * as McpOAuth from "./oauth.js"

import {
  auth,
  LATEST_PROTOCOL_VERSION,
  checkResourceAllowed,
  discoverOAuthServerInfo,
  extractWWWAuthenticateParams,
  parseErrorResponse,
  resourceUrlFromServerUrl,
  UnauthorizedError,
  type FetchLike,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client"
import { OAuthMetadataSchema, OpenIdProviderDiscoveryMetadataSchema } from "@modelcontextprotocol/core"
import { Cause, Deferred, Effect } from "effect"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { Credential } from "../credential.js"
import { OauthCallbackPage } from "../oauth/page.js"
import type { Integration } from "../integration.js"
import { ErrorSummary } from "../util/error-summary.js"

/** Client ID Metadata Document: servers that support CIMD accept this URL as the client_id without registration. */
export const CLIENT_METADATA_URL = "https://opencode.ai/oauth/opencode/client.json"

// Refresh tokens rotate, so concurrent refreshes of the same token share one request or the second gets invalid_grant.
const refreshes = new Map<string, ReturnType<FetchLike>>()

const refreshKey = (url: string | URL, init: RequestInit | undefined) => {
  if (!(init?.body instanceof URLSearchParams) || init.body.get("grant_type") !== "refresh_token") return undefined
  return [String(url), init.body.get("client_id") ?? "", init.body.get("refresh_token") ?? ""].join("\u0000")
}

// Bun's and Node's fetch types both apply here and the SDK's FetchLike wants Bun's Response, so the
// overload is picked by annotation and clone() is pinned to the type it was called on.
const base: FetchLike = fetch
const share = (pending: ReturnType<FetchLike>) => pending.then((response) => response.clone() as typeof response)

const send: FetchLike = (url, init) => {
  const key = refreshKey(url, init)
  if (key === undefined) return base(url, init)
  const current = refreshes.get(key)
  if (current) return share(current)
  const pending = base(url, init).finally(() => {
    if (refreshes.get(key) === pending) refreshes.delete(key)
  })
  refreshes.set(key, pending)
  return share(pending)
}

export const loggedFetch = (fields: { readonly server: string; readonly directory?: string }) =>
  Effect.gen(function* () {
    const run = Effect.runPromiseWith(yield* Effect.context())
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
export const configuredDiscovery = async (input: {
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

export interface Store {
  readonly tokens: () => Promise<StoredOAuthTokens | undefined>
  readonly saveTokens: (tokens: StoredOAuthTokens) => Promise<void>
  readonly clientInformation: () => Promise<StoredOAuthClientInformation | undefined>
  readonly saveClientInformation: (info: StoredOAuthClientInformation) => Promise<void>
  readonly codeVerifier: () => Promise<string | undefined>
  readonly saveCodeVerifier: (verifier: string) => Promise<void>
}

export interface Options {
  readonly config: typeof ConfigMCP.Remote.Type
  readonly store: Store
  /** Absent on connect: the provider then refuses to register a client or redirect, ending in needs_auth. */
  readonly redirect?: {
    readonly url: string
    readonly state: string
    readonly open: (url: URL) => void | Promise<void>
  }
  readonly clientMetadataUrl?: string
  readonly discovery?: OAuthDiscoveryState
  readonly invalidate?: OAuthClientProvider["invalidateCredentials"]
}

export const provider = (options: Options): OAuthClientProvider => {
  const oauth = options.config.oauth || undefined
  const client = oauth?.client_id ? { client_id: oauth.client_id, client_secret: oauth.client_secret } : undefined
  const redirect = options.redirect
  // A missing redirectUrl selects the client-credentials grant in the SDK, so connect still names one.
  const redirectUrl = redirect?.url ?? oauth?.redirect_uri ?? "http://127.0.0.1/callback"
  const refuse = (what: string) => new UnauthorizedError(`MCP server "${options.config.url}" requires ${what}`)
  const identity = new URL(options.config.url)
  identity.hash = ""
  let discovery: OAuthDiscoveryState | undefined = options.discovery
  return {
    redirectUrl,
    discoveryState: async () => {
      discovery ??= await configuredDiscovery({ config: options.config, fetchFn: send })
      return discovery
    },
    saveDiscoveryState: (state) => {
      discovery = state
    },
    // The SDK sends no RFC 8707 resource when the server publishes no resource metadata; some
    // authorization servers require one, so fall back to the configured URL.
    validateResourceURL: async (_serverUrl, resource) => {
      if (!resource) return identity
      if (!checkResourceAllowed({ requestedResource: identity, configuredResource: resource }))
        throw new Error(`Protected resource ${resource} does not cover ${identity}`)
      return new URL(resource)
    },
    ...(options.clientMetadataUrl ? { clientMetadataUrl: options.clientMetadataUrl } : {}),
    ...(redirect ? { state: () => redirect.state } : {}),
    clientMetadata: {
      redirect_uris: [redirectUrl],
      client_name: "opencode",
      client_uri: "https://opencode.ai",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: client?.client_secret ? "client_secret_post" : "none",
      ...(oauth?.scope ? { scope: oauth.scope } : {}),
    },
    clientInformation: async () => {
      if (client) return client
      const stored = await options.store.clientInformation()
      if (!stored && !redirect) throw refuse("a login before it can register a client")
      return stored
    },
    saveClientInformation: (info) => options.store.saveClientInformation(info),
    tokens: () => options.store.tokens(),
    saveTokens: (tokens) => options.store.saveTokens(tokens),
    redirectToAuthorization: (url) => {
      if (!redirect) throw refuse("user authorization")
      return redirect.open(url)
    },
    ...(options.invalidate ? { invalidateCredentials: options.invalidate } : {}),
    saveCodeVerifier: (verifier) => options.store.saveCodeVerifier(verifier),
    codeVerifier: async () => {
      const verifier = await options.store.codeVerifier()
      if (!verifier) throw new Error("Missing PKCE code verifier for MCP OAuth flow")
      return verifier
    },
  }
}

export const memoryStore = (): Store => {
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

export const toCredential = (input: {
  readonly methodID: Integration.MethodID
  readonly serverUrl: string
  readonly tokens: StoredOAuthTokens
  readonly client: StoredOAuthClientInformation | undefined
}) =>
  Credential.OAuth.make({
    type: "oauth",
    methodID: input.methodID,
    access: input.tokens.access_token,
    refresh: input.tokens.refresh_token ?? "",
    // 0 is non-expiring; toTokens then omits expires_in so the SDK does not force a refresh.
    expires: input.tokens.expires_in ? Date.now() + input.tokens.expires_in * 1000 : 0,
    metadata: {
      serverUrl: input.serverUrl,
      tokenType: input.tokens.token_type,
      ...(input.tokens.scope ? { scope: input.tokens.scope } : {}),
      ...(input.tokens.issuer ? { issuer: input.tokens.issuer } : {}),
      ...(input.client ? { client: input.client } : {}),
    },
  })

export const toTokens = (credential: Credential.OAuth): StoredOAuthTokens => {
  const metadata = credential.metadata ?? {}
  return {
    access_token: credential.access,
    token_type: typeof metadata.tokenType === "string" ? metadata.tokenType : "Bearer",
    ...(credential.refresh ? { refresh_token: credential.refresh } : {}),
    ...(credential.expires ? { expires_in: Math.max(0, Math.floor((credential.expires - Date.now()) / 1000)) } : {}),
    ...(typeof metadata.scope === "string" ? { scope: metadata.scope } : {}),
    ...(typeof metadata.issuer === "string" ? { issuer: metadata.issuer } : {}),
  }
}

export const connectProvider = Effect.fnUntraced(function* (input: {
  readonly config: typeof ConfigMCP.Remote.Type
  readonly integrationID: Integration.ID
}) {
  const credentials = yield* Credential.Service
  const run = Effect.runPromiseWith(yield* Effect.context())
  const found = (yield* credentials.list(input.integrationID)).at(-1)
  if (!found || found.value.type !== "oauth") return provider({ config: input.config, store: memoryStore() })
  const id = found.id
  const methodID = found.value.methodID
  const read = async () => {
    const stored = await run(credentials.get(id))
    return stored?.value.type === "oauth" ? stored.value : undefined
  }
  // Refresh tokens rotate and the row is shared across connections: only drop it while it still holds ours.
  let presented = found.value.refresh
  return provider({
    config: input.config,
    invalidate: async (scope) => {
      if (scope === "verifier" || scope === "discovery") return
      const oauth = await read()
      if (!oauth || oauth.refresh !== presented) return
      await run(Effect.logWarning("mcp oauth credential invalidated", { credentialID: id, scope }))
      await run(credentials.remove(id))
    },
    store: {
      tokens: async () => {
        const oauth = await read()
        if (!oauth) return undefined
        presented = oauth.refresh
        return toTokens(oauth)
      },
      saveTokens: async (tokens) => {
        const previous = await read()
        const value = toCredential({
          methodID,
          serverUrl: input.config.url,
          tokens,
          client: previous ? clientFromCredential(previous) : undefined,
        })
        presented = value.refresh
        await run(credentials.update(id, { value }))
      },
      clientInformation: async () => {
        const oauth = await read()
        return oauth ? clientFromCredential(oauth) : undefined
      },
      saveClientInformation: async (client) => {
        const oauth = await read()
        if (!oauth) return
        await run(credentials.update(id, { value: { ...oauth, metadata: { ...oauth.metadata, client } } }))
      },
      codeVerifier: async () => undefined,
      saveCodeVerifier: async () => {},
    },
  })
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
    const code = yield* Deferred.make<{ code: string; iss: string | undefined }, Error>()
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
        Effect.runFork(Deferred.fail(code, new Error(reason)))
        response
          .writeHead(400, { "Content-Type": "text/html" })
          .end(OauthCallbackPage.error(reason, { provider: input.name }))
      }
      const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
      if (error) return fail(error, "authorization_error")
      if (url.searchParams.get("state") !== state) return fail("OAuth state mismatch", "state_mismatch")
      const value = url.searchParams.get("code")
      if (!value) return fail("Missing authorization code", "missing_code")
      Effect.runFork(Deferred.succeed(code, { code: value, iss: url.searchParams.get("iss") ?? undefined }))
      response.writeHead(200, { "Content-Type": "text/html" }).end(OauthCallbackPage.success({ provider: input.name }))
    })

    // callback_port, else the port pinned by redirect_uri, else ephemeral; a mismatch strands the browser.
    const redirectPort = Number(redirect?.port) || undefined
    const port = yield* Effect.callback<number, Error>((resume) => {
      server.once("error", (error) => resume(Effect.fail(error)))
      server.listen(oauth?.callback_port ?? redirectPort ?? 0, "127.0.0.1", () => {
        const address = server.address()
        resume(
          address && typeof address === "object"
            ? Effect.succeed(address.port)
            : Effect.fail(new Error("Could not determine MCP OAuth callback port")),
        )
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

    let authorizationUrl: URL | undefined
    const oauthProvider = provider({
      config: input.config,
      store,
      clientMetadataUrl: cimd ? CLIENT_METADATA_URL : undefined,
      discovery: { ...discovery, resourceMetadataUrl: resourceMetadataUrl?.toString() },
      redirect: {
        url: oauth?.redirect_uri ?? `http://127.0.0.1:${port}${redirectPath}`,
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
      return toCredential({ methodID: input.methodID, serverUrl: input.config.url, tokens, client })
    })

    yield* Effect.tryPromise({
      try: () => auth(oauthProvider, { serverUrl: input.config.url, scope: oauth?.scope ?? challenge.scope, fetchFn }),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })

    if (!authorizationUrl)
      return yield* Effect.fail(new Error(`MCP server "${input.name}" did not provide an authorization URL`))

    return {
      url: authorizationUrl.toString(),
      instructions: `Authorize ${input.name} in your browser. This window will close automatically.`,
      mode: "auto" as const,
      callback: Deferred.await(code).pipe(
        Effect.flatMap((value) =>
          Effect.tryPromise({
            try: () =>
              auth(oauthProvider, {
                serverUrl: input.config.url,
                authorizationCode: value.code,
                iss: value.iss,
                scope: oauth?.scope ?? challenge.scope,
                fetchFn,
              }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }),
        ),
        Effect.flatMap(() => finalize),
        Effect.onError((cause) =>
          Effect.logWarning("mcp oauth authorization failed", { errors: ErrorSummary.from(Cause.squash(cause)) }),
        ),
        Effect.annotateLogs(fields),
      ),
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
