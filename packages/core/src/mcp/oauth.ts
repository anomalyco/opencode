export * as McpOAuth from "./oauth.js"

import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client"
import { Deferred, Effect } from "effect"
import { Credential } from "@opencode-ai/schema/credential"
import { ConfigMCP } from "@opencode-ai/schema/config/mcp"
import { OauthCallbackPage } from "../oauth/page.js"
import type { Integration } from "../integration.js"

/** Persists the OAuth artifacts for one MCP server session. Discovery state must live as long as PKCE. */
export interface Store {
  readonly tokens: () => Promise<StoredOAuthTokens | undefined>
  readonly saveTokens: (tokens: StoredOAuthTokens) => Promise<void>
  readonly clientInformation: () => Promise<StoredOAuthClientInformation | undefined>
  readonly saveClientInformation: (info: StoredOAuthClientInformation) => Promise<void>
  readonly codeVerifier: () => Promise<string | undefined>
  readonly saveCodeVerifier: (verifier: string) => Promise<void>
  readonly discoveryState?: () => Promise<OAuthDiscoveryState | undefined>
  readonly saveDiscoveryState?: (state: OAuthDiscoveryState) => Promise<void>
}

export interface Options {
  /** Loopback URL the authorization server redirects back to after the user approves. */
  readonly redirectUrl: string
  /** Space-delimited OAuth scopes to request when the server requires specific ones. */
  readonly scope?: string
  /** CSRF state embedded in the authorization request; required by the spec and enforced by some servers.
   * The caller is responsible for validating the value echoed back to the redirect. */
  readonly state?: string
  /** Statically pre-registered client credentials from config; when set, the SDK skips dynamic registration. */
  readonly client?: { readonly id: string; readonly secret?: string }
  /** Invoked by the SDK to drop credentials it has determined are invalid (e.g. a rejected refresh token). */
  readonly invalidate?: (scope: "all" | "client" | "tokens" | "verifier" | "discovery") => void | Promise<void>
  /** Receives the authorization URL so the caller can open a browser and capture the eventual code. */
  readonly onRedirect: (url: URL) => void | Promise<void>
  readonly store: Store
}

/**
 * Builds the MCP SDK's OAuthClientProvider. The SDK drives dynamic client registration, PKCE, and
 * token refresh through these callbacks; we only persist whatever it hands back via `store`.
 */
export const provider = (options: Options): OAuthClientProvider => {
  const state = options.state
  const client = options.client
  return {
    redirectUrl: options.redirectUrl,
    clientMetadata: {
      redirect_uris: [options.redirectUrl],
      client_name: "opencode",
      client_uri: "https://opencode.ai",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: client?.secret ? "client_secret_post" : "none",
      ...(options.scope ? { scope: options.scope } : {}),
    },
    // Only advertise state when the caller supplied one (the interactive flow); the connect-time
    // provider has no redirect to validate, so it omits it.
    ...(state !== undefined ? { state: () => state } : {}),
    // Static client config short-circuits dynamic registration; otherwise the SDK registers and we persist.
    clientInformation: async () => {
      const stored = await options.store.clientInformation()
      if (!client || (stored?.client_id === client.id && stored.client_secret === client.secret)) return stored
      return { client_id: client.id, client_secret: client.secret }
    },
    saveClientInformation: (info) => options.store.saveClientInformation(info),
    tokens: () => options.store.tokens(),
    saveTokens: (tokens) => options.store.saveTokens(tokens),
    discoveryState: options.store.discoveryState,
    saveDiscoveryState: options.store.saveDiscoveryState,
    redirectToAuthorization: (url) => options.onRedirect(url),
    ...(options.invalidate ? { invalidateCredentials: options.invalidate } : {}),
    saveCodeVerifier: (verifier) => options.store.saveCodeVerifier(verifier),
    // The SDK only reads the verifier back after saving one earlier in the same flow; a miss means
    // the flow was resumed without its session state, which the SDK surfaces as an auth failure.
    codeVerifier: async () => {
      const verifier = await options.store.codeVerifier()
      if (!verifier) throw new Error("Missing PKCE code verifier for MCP OAuth flow")
      return verifier
    },
  }
}

/** A Store that keeps OAuth artifacts in memory for the duration of one interactive login attempt. */
export const memoryStore = (): Store => {
  let tokens: StoredOAuthTokens | undefined
  let client: StoredOAuthClientInformation | undefined
  let verifier: string | undefined
  let discovery: OAuthDiscoveryState | undefined
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
    discoveryState: async () => discovery,
    saveDiscoveryState: async (value) => {
      discovery = value
    },
  }
}

/** Reads the dynamically-registered client info we stash in a credential's metadata, for token refresh. */
export const clientFromCredential = (credential: Credential.OAuth) =>
  credential.metadata?.client as StoredOAuthClientInformation | undefined

/** Folds SDK tokens (plus DCR client info and the server URL) into a storable credential. */
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
    // 0 marks an unknown/non-expiring token; toTokens then omits expires_in so the SDK won't force a refresh.
    expires: input.tokens.expires_in ? Date.now() + input.tokens.expires_in * 1000 : 0,
    metadata: {
      serverUrl: input.serverUrl,
      tokenType: input.tokens.token_type,
      ...(input.tokens.issuer !== undefined ? { issuer: input.tokens.issuer } : {}),
      ...(input.tokens.scope ? { scope: input.tokens.scope } : {}),
      ...(input.client ? { client: input.client } : {}),
    },
  })

/** Reconstructs SDK tokens from a stored credential so the connect-time provider can present them. */
export const toTokens = (credential: Credential.OAuth): StoredOAuthTokens => {
  const metadata = credential.metadata ?? {}
  return {
    access_token: credential.access,
    token_type: typeof metadata.tokenType === "string" ? metadata.tokenType : "Bearer",
    ...(typeof metadata.issuer === "string" ? { issuer: metadata.issuer } : {}),
    ...(credential.refresh ? { refresh_token: credential.refresh } : {}),
    ...(credential.expires ? { expires_in: Math.max(0, Math.floor((credential.expires - Date.now()) / 1000)) } : {}),
    ...(typeof metadata.scope === "string" ? { scope: metadata.scope } : {}),
  }
}

/**
 * Runs the interactive OAuth login for one remote MCP server. Stands up a loopback callback server,
 * lets the SDK drive DCR + PKCE to produce an authorization URL, and returns an attempt whose callback
 * exchanges the redirect code for a storable credential. Scoped: the callback server closes with the scope.
 */
export const authorize = (input: {
  readonly name: string
  readonly config: typeof ConfigMCP.Remote.Type
  readonly methodID: Integration.MethodID
}) =>
  Effect.gen(function* () {
    const oauth = input.config.oauth || undefined
    const store = memoryStore()
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
      const fail = (reason: string) => {
        Effect.runFork(Deferred.fail(code, new Error(reason)))
        response
          .writeHead(400, { "Content-Type": "text/html" })
          .end(OauthCallbackPage.error(reason, { provider: input.name }))
      }
      const error = url.searchParams.get("error_description") ?? url.searchParams.get("error")
      if (error) return fail(error)
      // Reject a redirect whose state does not match what we issued: this is the CSRF defense the
      // state parameter exists for, so an attacker can't inject their own authorization code.
      if (url.searchParams.get("state") !== state) return fail("OAuth state mismatch")
      const value = url.searchParams.get("code")
      if (!value) return fail("Missing authorization code")
      Effect.runFork(Deferred.succeed(code, { code: value, iss: url.searchParams.get("iss") ?? undefined }))
      response.writeHead(200, { "Content-Type": "text/html" }).end(OauthCallbackPage.success({ provider: input.name }))
    })

    // Bind the port the redirect will actually arrive on: an explicit callback_port wins, else the port
    // pinned by redirect_uri, else an ephemeral port. Binding ephemerally while redirect_uri names a fixed
    // port would send the browser somewhere nothing is listening, hanging the attempt until it expires.
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

    let authorizationUrl: URL | undefined
    const oauthProvider = provider({
      redirectUrl: oauth?.redirect_uri ?? `http://127.0.0.1:${port}${redirectPath}`,
      scope: oauth?.scope,
      state,
      client: oauth?.client_id ? { id: oauth.client_id, secret: oauth.client_secret } : undefined,
      onRedirect: (url) => {
        authorizationUrl = url
      },
      store,
    })

    const finalize = Effect.gen(function* () {
      const tokens = yield* Effect.promise(() => store.tokens())
      if (!tokens) return yield* Effect.fail(new Error(`MCP server "${input.name}" did not return OAuth tokens`))
      const client = yield* Effect.promise(() => store.clientInformation())
      return toCredential({ methodID: input.methodID, serverUrl: input.config.url, tokens, client })
    })

    yield* Effect.tryPromise({
      try: () => auth(oauthProvider, { serverUrl: input.config.url, scope: oauth?.scope }),
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
                scope: oauth?.scope,
              }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }),
        ),
        Effect.flatMap(() => finalize),
      ),
    }
  })
