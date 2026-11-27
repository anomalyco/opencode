export * as OpenAIAccountModels from "./openai-account-models.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Credential } from "../../credential.js"
import { IntegrationConnection } from "../../integration/connection.js"
import type { Model } from "../../model.js"
import { SharedCache } from "../../shared-cache.js"
import { storedCredential } from "./credential-settings.js"
import { ProviderRefresh } from "./refresh.js"

// The ChatGPT subscription sign-ins serve each account the models and speeds its plan includes, such as Ultrafast
// only on some plans. OpenAI lists them per account, in the same shape for the Codex and Sign in with ChatGPT routes.
// That list decides the speeds of each model it names. It never hides a model on its own: it has left out models
// the account could use for days after a launch, so a model it doesn't name falls back to the models.dev plan list.

/** The speeds (service tier IDs) each model the account can pick offers it, by model ID. */
export type Account = ReadonlyMap<string, ReadonlySet<string>>

const Remote = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      slug: Schema.String,
      visibility: Schema.String,
      supported_in_api: Schema.optional(Schema.Boolean),
      service_tiers: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ id: Schema.String })))),
    }),
  ),
})

/**
 * Keeps the active OpenAI sign-in's own model list current, while `request` returns one for its credential: at
 * startup, on an account switch and every few minutes, reloading providers when it changes. `current` is undefined
 * until a list loads, or when the active connection isn't this sign-in.
 */
export const track = Effect.fnUntraced(function* (
  ctx: Context,
  input: {
    readonly name: string
    readonly request: (credential: Credential.Value) => HttpClientRequest.HttpClientRequest | undefined
  },
) {
  const cache = yield* SharedCache.Service
  const credentials = yield* Credential.Service
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
  return yield* ProviderRefresh.start({
    integrationID: "openai",
    initial: undefined as Account | undefined,
    active: ctx.integration.connection.active("openai"),
    reload: ctx.provider.reload(),
    load: Effect.fn("OpenAIAccountModels.load")(function* (_, options) {
      const { connection, credential } = yield* storedCredential(ctx, "openai").pipe(
        Effect.provideService(Credential.Service, credentials),
      )
      if (!connection || !credential || !input.request(credential)) return { connection, value: undefined }
      const value = yield* cache
        .get({
          key: `openai-account-models:${input.name}:${IntegrationConnection.key(connection)}`,
          ...options,
          // Resolving refreshes the token when it's about to expire.
          load: ctx.integration.connection.resolve(connection).pipe(
            Effect.flatMap((current) => {
              const request = current && input.request(current)
              if (!request) return Effect.fail(new Error("The OpenAI sign-in has no token"))
              return http
                .execute(request)
                .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Remote)), Effect.timeout("15 seconds"))
            }),
            Effect.map((remote) => {
              const listed = remote.models.filter(
                (model) => model.visibility === "list" && model.supported_in_api !== false,
              )
              if (listed.length === 0) return undefined
              return new Map(
                listed.map((model) => [model.slug, new Set(model.service_tiers?.map((tier) => tier.id) ?? [])]),
              )
            }),
          ),
        })
        .pipe(Effect.orElseSucceed(() => undefined))
      return { connection, value }
    }),
  })
})

/**
 * Whether the sign-in can use `model`: the account's list decides the models it names and their speeds, and the
 * models.dev plan list the rest. Undefined when neither list is known.
 */
export function allowed(
  model: Pick<Model.Info, "id" | "experimental">,
  plan: ReadonlySet<string> | undefined,
  account: Account | undefined,
) {
  const speed = model.experimental?.speed
  const tiers = account?.get(speed?.base ?? model.id)
  if (!tiers) return plan?.has(model.id)
  if (!speed) return true
  // models.dev names OpenAI's "priority" tier "fast".
  return tiers.has(speed.id) || (speed.id === "fast" && tiers.has("priority"))
}
