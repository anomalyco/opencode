import { Clock, Effect, Schema } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import type { IntegrationOAuthPrompt } from "@opencode/plugin/effect/integration"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Provider } from "../../provider.js"

const providerID = Provider.ID.make("vercel")
const methodID = Integration.MethodID.make("gateway-setup")
// Temporary default from vercel/vercel packages/cli/src/util/oauth.ts.
const vercelCLIClientID = "cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp"
const Discovery = Schema.Struct({ device_authorization_endpoint: Schema.String, token_endpoint: Schema.String })
const Device = Schema.Struct({
  device_code: Schema.NonEmptyString,
  user_code: Schema.NonEmptyString,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optional(Schema.String),
  expires_in: Schema.Number,
  interval: Schema.optional(Schema.Number),
})
const Token = Schema.Struct({ access_token: Schema.NonEmptyString })
const OAuthError = Schema.Struct({ error: Schema.String })
const Teams = Schema.Struct({
  teams: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, slug: Schema.NonEmptyString, name: Schema.String })),
  pagination: Schema.optional(Schema.Struct({ next: Schema.NullOr(Schema.Number) })),
})
const CreatedKey = Schema.Struct({ apiKeyString: Schema.NonEmptyString, apiKey: Schema.Struct({ id: Schema.String }) })

/** A dedicated OAuth application can override the temporary Vercel CLI client ID. */
export function make(options: { clientID?: string; issuer?: string; api?: string } = {}) {
  return define({
    id: "opencode.provider.vercel.gateway",
    effect: Effect.fn(function* (ctx) {
      yield* ctx.integration.transform((editor) => {
        editor.method.update({
          integrationID: providerID,
          method: { id: methodID, type: "oauth", label: "Set up Vercel AI Gateway" },
          authorize: (_answer, prompt) =>
            Effect.gen(function* () {
              const clientID = options.clientID ?? process.env.OPENCODE_VERCEL_CLIENT_ID ?? vercelCLIClientID
              const issuer = options.issuer ?? "https://vercel.com"
              const discovery = yield* request(`${issuer}/.well-known/openid-configuration`, {}, Discovery)
              const device = yield* request(
                discovery.device_authorization_endpoint,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  body: new URLSearchParams({ client_id: clientID, scope: "openid" }),
                },
                Device,
              )
              if (!Number.isFinite(device.expires_in) || device.expires_in <= 0) {
                return yield* Effect.fail(new Error("Vercel returned an invalid device-code expiration"))
              }
              const now = yield* Clock.currentTimeMillis
              const receipt: { url?: string } = {}
              const expires = now + device.expires_in * 1000
              const poll = (interval: number): Effect.Effect<string, unknown> =>
                Effect.gen(function* () {
                  yield* Effect.sleep(interval)
                  if ((yield* Clock.currentTimeMillis) >= expires)
                    return yield* Effect.fail(new Error("Vercel sign-in expired. Start setup again."))
                  const response = yield* send(discovery.token_endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                      client_id: clientID,
                      device_code: device.device_code,
                      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                    }),
                  })
                  if (response.ok) return (yield* decode(response, Token)).access_token
                  const error = yield* decode(response, OAuthError)
                  if (error.error === "authorization_pending") return yield* poll(interval)
                  if (error.error === "slow_down") return yield* poll(interval + 5000)
                  return yield* Effect.fail(
                    new Error(
                      error.error === "access_denied"
                        ? "Vercel sign-in was denied. Start setup again when ready."
                        : error.error === "expired_token"
                          ? "Vercel sign-in expired. Start setup again."
                          : "Vercel sign-in failed.",
                    ),
                  )
                })
              return {
                mode: "auto" as const,
                url: device.verification_uri_complete ?? device.verification_uri,
                instructions: `Sign in to Vercel and enter code ${device.user_code}. Then return here to choose a team and create an AI Gateway key.`,
                // Leave time for the setup interview after the device authorization completes.
                expiresAt: Math.max(expires, now + 10 * 60_000),
                onComplete: () =>
                  receipt.url ? { title: "Set a spending limit (optional)", url: receipt.url } : undefined,
                callback: poll(Math.max(1, device.interval ?? 5) * 1000).pipe(
                  Effect.flatMap((token) => setup(options.api ?? "https://api.vercel.com", token, prompt)),
                  Effect.tap((value) =>
                    Effect.sync(() => {
                      receipt.url = String(value.metadata?.manageURL)
                    }),
                  ),
                ),
              }
            }),
        })
        editor.method.update({ integrationID: providerID, method: { type: "key", label: "Use an existing API key" } })
      })
    }),
  })
}

export const VercelGatewayPlugin = make()

function setup(api: string, token: string, prompt: IntegrationOAuthPrompt) {
  return Effect.gen(function* () {
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    const teams: Array<(typeof Teams.Type.teams)[number]> = []
    let next: number | null = null
    do {
      const url = new URL("/v2/teams", api)
      url.searchParams.set("limit", "100")
      if (next !== null) url.searchParams.set("until", String(next))
      const page = yield* request(url.href, { headers }, Teams)
      teams.push(...page.teams)
      next = page.pagination?.next ?? null
    } while (next !== null)
    if (!teams.length)
      return yield* Effect.fail(
        new Error(
          "No Vercel teams are available. Create or join a team at https://vercel.com/dashboard, then start setup again.",
        ),
      )
    const selected = yield* prompt({
      title: "Choose a Vercel team",
      fields: [
        {
          type: "string",
          key: "team",
          title: "Team",
          required: true,
          options: teams.map((team) => ({ value: team.id, label: team.name, description: team.slug })),
        },
      ],
    })
    const team = teams.find((team) => team.id === selected.team)
    if (!team) return yield* Effect.fail(new Error("Select an available Vercel team"))
    const settings = yield* prompt({
      title: "Create an AI Gateway key",
      fields: [
        {
          type: "string",
          key: "name",
          title: "Key name",
          default: "OpenCode",
          required: true,
          minLength: 1,
          maxLength: 255,
        },
        {
          type: "string",
          key: "expiration",
          title: "Key expiration",
          default: "none",
          required: true,
          options: [
            { value: "none", label: "No expiration" },
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
          ],
        },
      ],
    })
    const confirmation = yield* prompt({
      title: "Review Vercel AI Gateway setup",
      fields: [
        {
          type: "boolean",
          key: "create",
          title: "Create key and connect?",
          default: true,
          required: true,
          description: `Team: ${team.name} (${team.slug}). Key: ${settings.name}. Expiration: ${settings.expiration === "none" ? "none" : `${settings.expiration} days`}. No spending limit. You can set a budget later in Vercel's AI Gateway settings.`,
        },
      ],
    })
    if (!confirmation.create) return yield* Effect.fail(new Error("Setup cancelled. No API key was created."))
    const created = yield* Clock.currentTimeMillis
    const result = yield* request(
      `${api}/v1/api-keys?teamId=${encodeURIComponent(team.id)}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          purpose: "ai-gateway",
          name: settings.name,
          ...(settings.expiration === "none" ? {} : { expiresAt: created + Number(settings.expiration) * 86_400_000 }),
        }),
      },
      CreatedKey,
    )
    return Credential.Key.make({
      type: "key",
      key: result.apiKeyString,
      metadata: {
        teamID: team.id,
        teamSlug: team.slug,
        keyID: result.apiKey.id,
        manageURL: `https://vercel.com/${encodeURIComponent(team.slug)}/~/ai-gateway/api-keys`,
      },
    })
  })
}

function send(url: string, init: RequestInit) {
  return Effect.tryPromise({
    try: (signal) => fetch(url, { ...init, signal }),
    catch: () => new Error("Could not reach Vercel. Check your connection and retry."),
  }).pipe(Effect.timeout("15 seconds"))
}

function decode<S extends Schema.Decoder<unknown>>(response: Response, schema: S) {
  return Effect.tryPromise({
    try: () => response.json(),
    catch: () => new Error("Vercel returned an invalid response"),
  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema)))
}

function request<S extends Schema.Decoder<unknown>>(url: string, init: RequestInit, schema: S) {
  return send(url, init).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? decode(response, schema)
        : Effect.fail(
            new Error(
              response.status === 401
                ? "Vercel authorization expired. Sign in again."
                : response.status === 403
                  ? "Vercel did not allow this action. Check your team permissions."
                  : `Vercel request failed (${response.status}). Try again.`,
            ),
          ),
    ),
  )
}
