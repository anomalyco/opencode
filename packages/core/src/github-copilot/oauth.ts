export * as CopilotOAuth from "./oauth.js"

import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { Credential } from "@opencode/schema/credential"
import { Integration } from "@opencode/schema/integration"
import { Clock, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { App } from "../app.js"

const clientID = "Ov23li8tweQw6odWQebz"
const methodID = Integration.MethodID.make("device")
const lifetime = Schema.Int.check(Schema.isGreaterThan(0))
const Device = Schema.Struct({
  verification_uri: Schema.String,
  user_code: Schema.String,
  device_code: Schema.String,
  interval: Schema.Number,
})
const Token = Schema.Struct({
  access_token: Schema.optional(Schema.NonEmptyString),
  refresh_token: Schema.optional(Schema.NonEmptyString),
  expires_in: Schema.optional(lifetime),
  refresh_token_expires_in: Schema.optional(lifetime),
  error: Schema.optional(Schema.String),
  interval: Schema.optional(Schema.Number),
})

export const userApiVersion = "2025-04-01"
export const User = Schema.Struct({
  chat_enabled: Schema.optional(Schema.Boolean),
  can_signup_for_limited: Schema.optional(Schema.Boolean),
  endpoints: Schema.optional(Schema.Struct({ api: Schema.optional(Schema.String) })),
})

export const method = (app: App.Info, http: HttpClient.HttpClient, preferExpiring: Effect.Effect<boolean>) =>
  ({
    integrationID: Integration.ID.make("github-copilot"),
    method: {
      id: methodID,
      type: "oauth",
      label: "Login with GitHub Copilot",
      form: [
        {
          type: "string",
          key: "deploymentType",
          title: "Select GitHub deployment type",
          required: true,
          options: [
            { label: "GitHub.com", value: "github.com", description: "Public" },
            { label: "GitHub Enterprise", value: "enterprise", description: "Data residency or self-hosted" },
          ],
        },
        {
          type: "string",
          key: "enterpriseUrl",
          title: "Enter your GitHub Enterprise URL or domain",
          placeholder: "company.ghe.com or https://company.ghe.com",
          required: true,
          when: [{ key: "deploymentType", op: "eq", value: "enterprise" }],
        },
      ],
    },
    refresh: (value) =>
      Effect.gen(function* () {
        // Legacy credentials kept the non-expiring GitHub token in `refresh`.
        if (value.metadata?.refreshable !== true)
          return Credential.OAuth.make({ ...value, access: value.refresh, expires: 0 })
        const now = yield* Clock.currentTimeMillis
        if (typeof value.metadata.refreshExpires === "number" && value.metadata.refreshExpires <= now)
          return yield* Effect.fail(reauthenticate())
        const domain =
          typeof value.metadata.enterpriseUrl === "string"
            ? normalizeDomain(value.metadata.enterpriseUrl)
            : "github.com"
        const response = yield* exchange(http, app, domain, {
          grant_type: "refresh_token",
          refresh_token: value.refresh,
        })
        if (response.status < 500 && ["bad_refresh_token", "invalid_grant"].includes(response.token.error ?? ""))
          return yield* Effect.fail(reauthenticate())
        if (response.token.error === "incorrect_client_credentials")
          return yield* Effect.fail(
            new Error("GitHub rejected OpenCode's OAuth client. Update OpenCode and try again."),
          )
        if (response.status !== 200 || response.token.error)
          return yield* Effect.fail(new Error("GitHub token refresh failed. Try again."))
        return yield* credential(response.token, now, value.metadata, value)
      }),
    authorize: (answer) =>
      Effect.gen(function* () {
        const enterprise = answer.deploymentType === "enterprise"
        const enterpriseUrl = typeof answer.enterpriseUrl === "string" ? answer.enterpriseUrl : undefined
        if (enterprise && !enterpriseUrl) return yield* Effect.fail(new Error("Enterprise URL is required"))
        const domain = enterprise ? normalizeDomain(enterpriseUrl ?? "") : "github.com"
        const expiring = (yield* preferExpiring) && (domain === "github.com" || domain.endsWith(".ghe.com"))
        const device = yield* HttpClient.filterStatusOk(http)
          .execute(
            HttpClientRequest.post(`https://${domain}/login/device/code`).pipe(
              HttpClientRequest.setHeaders(headers(app)),
              HttpClientRequest.bodyJsonUnsafe({
                client_id: clientID,
                scope: expiring ? "read:user offline_access" : "read:user",
              }),
            ),
          )
          .pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Device)),
            Effect.mapError(() => new Error("Could not start GitHub device authorization")),
          )
        const poll = (wait: number): Effect.Effect<Credential.OAuth, unknown> =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const response = yield* exchange(http, app, domain, {
              device_code: device.device_code,
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            })
            if (response.status === 200 && response.token.access_token && !response.token.error) {
              const user = yield* HttpClient.filterStatusOk(http)
                .execute(
                  HttpClientRequest.get(userURL(enterprise ? domain : undefined)).pipe(
                    HttpClientRequest.setHeaders({
                      Accept: "application/json",
                      Authorization: `Bearer ${response.token.access_token}`,
                      "User-Agent": App.useragent(app),
                      "X-GitHub-Api-Version": userApiVersion,
                    }),
                  ),
                )
                .pipe(
                  Effect.flatMap(HttpClientResponse.schemaBodyJson(User)),
                  Effect.orElseSucceed(() => undefined),
                )
              const denied = user && copilotEntitlementError(user)
              if (denied) return yield* Effect.fail(new Error(denied))
              const apiEndpoint = user?.endpoints?.api?.replace(/\/+$/, "")
              return yield* credential(response.token, now, {
                ...(enterprise ? { enterpriseUrl: domain } : {}),
                ...(apiEndpoint ? { apiEndpoint } : {}),
              })
            }
            if (response.status < 500 && response.token.error === "authorization_pending")
              return yield* Effect.sleep(wait + 3000).pipe(Effect.andThen(poll(wait)))
            if (response.status < 500 && response.token.error === "slow_down") {
              const next =
                response.token.interval && response.token.interval > 0 ? response.token.interval * 1000 : wait + 5000
              return yield* Effect.sleep(next + 3000).pipe(Effect.andThen(poll(next)))
            }
            return yield* Effect.fail(new Error("GitHub device authorization failed. Try signing in again."))
          })
        return {
          mode: "auto" as const,
          url: device.verification_uri,
          instructions: `Enter code: ${device.user_code}`,
          callback: poll(Math.max(device.interval, 1) * 1000),
        }
      }),
  }) satisfies IntegrationOAuthMethodRegistration

/** GitHub tokens in legacy credentials were stored in `refresh`, not necessarily `access`. */
export function access(value: Credential.OAuth) {
  return value.metadata?.refreshable === true ? value.access : value.refresh
}

function credential(
  token: typeof Token.Type,
  now: number,
  metadata: Readonly<Record<string, unknown>>,
  previous?: Credential.OAuth,
) {
  if (!token.access_token) return Effect.fail(new Error("GitHub did not return an access token"))
  const refresh = token.refresh_token ?? (previous?.metadata?.refreshable === true ? previous.refresh : undefined)
  if (token.expires_in && !refresh)
    return Effect.fail(new Error("GitHub issued an expiring access token without a refresh token. Sign in again."))
  if (refresh && !token.expires_in)
    return Effect.fail(new Error("GitHub did not return an expiry for its refreshable access token"))
  const next = { ...metadata }
  delete next.refreshExpires
  if (token.refresh_token_expires_in) next.refreshExpires = now + token.refresh_token_expires_in * 1000
  else if (previous && refresh === previous.refresh && previous.metadata?.refreshExpires !== undefined)
    next.refreshExpires = previous.metadata.refreshExpires
  if (refresh) next.refreshable = true
  return Effect.succeed(
    Credential.OAuth.make({
      type: "oauth",
      methodID,
      access: token.access_token,
      refresh: refresh ?? token.access_token,
      expires: token.expires_in ? now + token.expires_in * 1000 : 0,
      ...(Object.keys(next).length > 0 ? { metadata: next } : {}),
    }),
  )
}

function exchange(http: HttpClient.HttpClient, app: App.Info, domain: string, body: Record<string, string>) {
  return http
    .execute(
      HttpClientRequest.post(`https://${domain}/login/oauth/access_token`).pipe(
        HttpClientRequest.setHeaders(headers(app)),
        HttpClientRequest.bodyJsonUnsafe({ client_id: clientID, ...body }),
      ),
    )
    .pipe(
      Effect.mapError(() => new Error("GitHub OAuth token request failed. Try again.")),
      Effect.flatMap((response) =>
        HttpClientResponse.schemaBodyJson(Token)(response).pipe(
          Effect.mapError(() => new Error("GitHub returned an invalid OAuth token response")),
          Effect.map((token) => ({ status: response.status, token })),
        ),
      ),
    )
}

function headers(app: App.Info) {
  return { Accept: "application/json", "Content-Type": "application/json", "User-Agent": App.useragent(app) }
}

function normalizeDomain(input: string) {
  return input
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase()
}

export function userURL(enterprise?: string) {
  return `${enterprise ? `https://api.${normalizeDomain(enterprise)}` : "https://api.github.com"}/copilot_internal/user`
}

function reauthenticate() {
  return new Error("GitHub Copilot authorization expired or was revoked. Reconnect with `opencode auth login`.")
}

export function copilotEntitlementError(user: { chat_enabled?: boolean; can_signup_for_limited?: boolean }) {
  if (user.chat_enabled !== false) return
  if (user.can_signup_for_limited)
    return "This GitHub account is not signed up for GitHub Copilot. Sign up for Copilot Free at https://github.com/features/copilot/plans and connect again."
  return "This GitHub account does not have GitHub Copilot access. It needs an active Copilot subscription or a seat assigned by an organization."
}
