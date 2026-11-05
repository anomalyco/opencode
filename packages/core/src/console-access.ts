export * as ConsoleAccess from "./console-access.js"

import { Context, Duration, Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { ConfigIntegration } from "./config/integration.js"

/**
 * How the host keeps a connected Console's config fresh. `poll` re-checks it every minute in the background; without
 * it, the config refreshes only when a prompt starts, so a host that suspends between prompts stays idle.
 */
export const Options = Context.Reference<{ readonly poll: boolean }>("@opencode/ConsoleAccess/Options", {
  defaultValue: () => ({ poll: true }),
})

export const configured = (options?: { readonly poll?: boolean }) =>
  makeGlobalNode({ service: Options, layer: Layer.succeed(Options, { poll: options?.poll ?? true }), deps: [] })

export const node = configured()

export const defaultServer = "https://opencode.ai/console"

/** The OpenCode Console a credential signed in to. */
export function server(value: Credential.Value) {
  const server = typeof value.metadata?.server === "string" ? value.metadata.server : defaultServer
  // Credentials saved before August 2026 store the retired console.opencode.ai host, which maps path-for-path onto
  // the default server; rewriting it lets that host be shut down without forcing those users to reconnect.
  return server.replace(/^https:\/\/console\.opencode\.ai(?=\/|$)/, defaultServer)
}

/** Authenticates a Console request as the credential's member, in the workspace the sign-in chose. */
export function headers(value: Credential.Key | Credential.OAuth): Record<string, string> {
  const orgID = value.metadata?.orgID
  return {
    authorization: `Bearer ${value.type === "oauth" ? value.access : value.key}`,
    ...(typeof orgID === "string" ? { "x-org-id": orgID } : {}),
  }
}

/** The organization a credential signed in to, as its members know it. */
export function organizationName(value: Credential.Value) {
  return typeof value.metadata?.orgName === "string" ? value.metadata.orgName : undefined
}

export const methodID = IntegrationMethodID.make("device")

const Device = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri_complete: Schema.String,
  expires_in: Schema.Number,
  interval: Schema.Number,
})
const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
  org_id: Schema.optional(Schema.NullOr(Schema.String)),
})
const TokenPending = Schema.Struct({ error: Schema.String })
const DeviceToken = Schema.Union([Token, TokenPending])
const User = Schema.Struct({ id: Schema.String, email: Schema.String })
const Org = Schema.Struct({ id: Schema.String, name: Schema.String })
// Console's 403 when the organization enforces SSO and the user's SSO proof is missing or expired.
const SsoRequired = Schema.Struct({
  _tag: Schema.Literal("SsoRequired"),
  orgId: Schema.String,
  connectionId: Schema.String,
})
const InvalidGrant = Schema.Struct({ error: Schema.Literal("invalid_grant") })
// Console's 401 when the session behind the access token was revoked or expired.
const Unauthorized = Schema.Struct({ _tag: Schema.Literal("Unauthorized") })

/** The Console's config document. `library` decodes where it's used, so a malformed one can't drop its policies. */
export const Config = Schema.Struct({
  ...ConfigIntegration.Remote.fields,
  library: Schema.Unknown.pipe(Schema.optional),
})
export type Config = typeof Config.Type

export const signedOutMessage = "Reconnect OpenCode Console to continue"
export const ssoMessage = (organization: string | undefined) =>
  `Sign in with SSO again to use ${organization ?? "your OpenCode Console organization"}`

export class SsoRequiredError extends Schema.TaggedError<SsoRequiredError>()("OpencodeConsole.SsoRequired", {
  organization: Schema.optional(Schema.String),
  url: Schema.String,
}) {
  override get message() {
    return `${ssoMessage(this.organization)}.`
  }
}

// The Console session or refresh token was revoked or expired; only a new device login recovers.
export class SignedOutError extends Schema.TaggedError<SignedOutError>()("OpencodeConsole.SignedOut", {}) {
  override get message() {
    return `${signedOutMessage}.`
  }
}

/**
 * Starts a device sign-in. Each client signs in with its own `clientID`, which its refreshes must repeat, and asks
 * for a session scoped to the workspace the member picks.
 */
export function authorize(http: HttpClient.HttpClient, input: unknown, clientID: string) {
  return Effect.gen(function* () {
    const server = yield* normalizeServer(input)
    const device = yield* post(
      http,
      `${server}/auth/device/code`,
      { client_id: clientID, supports_org_scope: true },
      Device,
    )
    const verification = yield* Effect.try({
      try: () => {
        const url = new URL(device.verification_uri_complete, `${server}/`)
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("expected HTTP(S)")
        return url
      },
      catch: (cause) =>
        new Error(`Invalid device verification URL: ${cause instanceof Error ? cause.message : String(cause)}`),
    })
    return {
      url: verification.href,
      code: device.user_code,
      callback: poll(http, server, device.device_code, Duration.seconds(device.interval), clientID),
    }
  })
}

/** Rotates a device sign-in's tokens. The refresh token is single-use, so callers serialize refreshes. */
export function refresh(http: HttpClient.HttpClient, credential: Credential.OAuth, clientID: string) {
  return Effect.gen(function* () {
    const response = yield* send(http, `${server(credential)}/auth/device/token`, {
      grant_type: "refresh_token",
      refresh_token: credential.refresh,
      client_id: clientID,
    })
    if (response.status === 400) {
      const body = yield* HttpClientResponse.schemaBodyJson(InvalidGrant)(response).pipe(Effect.option)
      if (Option.isSome(body)) return yield* new SignedOutError()
    }
    const token = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Token)),
    )
    // Persist rotated tokens without depending on discovery requests.
    return {
      ...credential,
      access: token.access_token,
      refresh: token.refresh_token,
      expires: Date.now() + token.expires_in * 1000,
      metadata:
        token.org_id == null
          ? credential.metadata
          : {
              ...credential.metadata,
              orgID: token.org_id,
              orgName:
                credential.metadata?.orgID === token.org_id && typeof credential.metadata.orgName === "string"
                  ? credential.metadata.orgName
                  : token.org_id,
            },
    }
  })
}

/** Ends a device sign-in's whole session (RFC 7009). The Console answers success even for unknown tokens. */
export function revoke(http: HttpClient.HttpClient, credential: Credential.OAuth, clientID: string) {
  return send(http, `${server(credential)}/auth/oauth/revoke`, {
    token: credential.refresh,
    token_type_hint: "refresh_token",
    client_id: clientID,
  }).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk), Effect.timeout(Duration.seconds(5)))
}

/** The credential's workspace config, or `undefined` when the Console serves none for it. */
export function fetchConfig(http: HttpClient.HttpClient, value: Credential.Key | Credential.OAuth) {
  return fetchDocument(http, value).pipe(
    Effect.flatMap((document) =>
      document === undefined ? Effect.succeed(undefined) : Schema.decodeUnknownEffect(Config)(document),
    ),
  )
}

/**
 * The credential's workspace config as the Console sent it, for clients that read its fields one at a time, or
 * `undefined` when the Console serves none for it.
 */
export function fetchDocument(http: HttpClient.HttpClient, value: Credential.Key | Credential.OAuth) {
  // Scoped so responses whose body is never read (404, errors) are released here instead of by a GC-time abort.
  return HttpClient.withScope(http)
    .execute(
      HttpClientRequest.get(`${server(value)}/api/v2/config`).pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeaders(headers(value)),
      ),
    )
    .pipe(
      Effect.flatMap((response) =>
        Effect.gen(function* () {
          if (response.status === 404) return undefined
          if (response.status === 401) {
            const body = yield* HttpClientResponse.schemaBodyJson(Unauthorized)(response).pipe(Effect.option)
            if (Option.isSome(body)) return yield* new SignedOutError()
          }
          if (response.status === 403) {
            const body = yield* HttpClientResponse.schemaBodyJson(SsoRequired)(response).pipe(Effect.option)
            if (Option.isSome(body))
              return yield* new SsoRequiredError({
                organization: organizationName(value),
                url: yield* ssoUrl(server(value), body.value.connectionId),
              })
          }
          const body = yield* HttpClientResponse.filterStatusOk(response).pipe(Effect.flatMap((ok) => ok.json))
          return yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown))(body)
        }),
      ),
      Effect.scoped,
      // A transient failure, which `SharedCache` retries.
      Effect.timeout(Duration.seconds(5)),
    )
}

export function normalizeServer(input: unknown) {
  return Effect.try({
    try: () => {
      if (typeof input !== "string") throw new Error("expected string")
      const url = new URL(input)
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("expected HTTP(S)")
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
    },
    catch: (cause) =>
      new Error(`Invalid OpenCode server URL: ${cause instanceof Error ? cause.message : String(cause)}`),
  })
}

function ssoUrl(server: string, connectionID: string) {
  return normalizeServer(server).pipe(
    Effect.map((base) => {
      // Console only redirects to paths under its own base path after SSO.
      const redirectTo = `${new URL(base).pathname.replace(/\/+$/, "")}/`
      return `${base}/auth/sso/${encodeURIComponent(connectionID)}/start?redirectTo=${encodeURIComponent(redirectTo)}`
    }),
  )
}

function poll(
  http: HttpClient.HttpClient,
  server: string,
  deviceCode: string,
  interval: Duration.Duration,
  clientID: string,
) {
  const loop = (wait: Duration.Duration): Effect.Effect<Credential.OAuth, unknown> =>
    Effect.gen(function* () {
      yield* Effect.sleep(wait)
      const result = yield* post(
        http,
        `${server}/auth/device/token`,
        {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: clientID,
        },
        DeviceToken,
        false,
      )
      if ("access_token" in result) return yield* credential(http, server, result)
      if (result.error === "authorization_pending") return yield* loop(wait)
      if (result.error === "slow_down") {
        return yield* loop(Duration.sum(wait, Duration.seconds(5)))
      }
      return yield* Effect.fail(new Error(`Device authorization failed: ${result.error}`))
    })
  return loop(interval)
}

function credential(http: HttpClient.HttpClient, server: string, token: typeof Token.Type) {
  return Effect.gen(function* () {
    const [user, orgs] = yield* Effect.all(
      [
        get(http, `${server}/api/user`, token.access_token, User),
        get(http, `${server}/api/orgs`, token.access_token, Schema.Array(Org)),
      ],
      { concurrency: 2 },
    )
    const org =
      token.org_id == null
        ? orgs.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0]
        : orgs.find((org) => org.id === token.org_id)
    if (token.org_id != null && !org) {
      return yield* Effect.fail(new Error(`OpenCode organization not found: ${token.org_id}`))
    }
    return Credential.OAuth.make({
      type: "oauth" as const,
      methodID,
      access: token.access_token,
      refresh: token.refresh_token,
      expires: Date.now() + token.expires_in * 1000,
      metadata: {
        server,
        accountID: user.id,
        email: user.email,
        orgID: org?.id,
        orgName: org?.name,
      },
    })
  })
}

function get<S extends Schema.Top>(http: HttpClient.HttpClient, url: string, token: string, schema: S) {
  return HttpClient.filterStatusOk(http)
    .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson, HttpClientRequest.bearerToken(token)))
    .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)))
}

function post<S extends Schema.Top>(
  http: HttpClient.HttpClient,
  url: string,
  body: Record<string, string | boolean>,
  schema: S,
  statusOk = true,
) {
  return send(http, url, body).pipe(
    Effect.flatMap((response) => (statusOk ? HttpClientResponse.filterStatusOk(response) : Effect.succeed(response))),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
  )
}

function send(http: HttpClient.HttpClient, url: string, body: Record<string, string | boolean>) {
  return HttpClientRequest.post(url).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.schemaBodyJson(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean])))(body),
    Effect.flatMap((request) => http.execute(request)),
  )
}
