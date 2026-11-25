import { Config } from "@opencode/core/config"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Provider } from "@opencode/core/provider"
import { ConflictError, ProviderNotFoundError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"
import { response } from "../location"
import { requireConnectable } from "./integration"

export const ProviderHandler = HttpApiBuilder.group(Api, "server.provider", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "provider.list",
        Effect.fn(function* () {
          const providers = yield* Provider.Service
          return yield* response(providers.available())
        }),
      )
      .handle(
        "provider.get",
        Effect.fn(function* (ctx) {
          const providers = yield* Provider.Service
          const provider = yield* providers.get(ctx.params.providerID)
          if (!provider)
            return yield* new ProviderNotFoundError({
              providerID: ctx.params.providerID,
              message: `Provider not found: ${ctx.params.providerID}`,
            })
          return yield* response(Effect.succeed(provider))
        }),
      )
      .handle(
        "provider.custom.create",
        Effect.fn(function* (ctx) {
          const input = ctx.payload
          const providers = yield* Provider.Service
          const integrations = yield* Integration.Service
          // Only new IDs: reusing a catalog or configured ID would send its stored credentials to this endpoint.
          if ((yield* providers.get(Provider.ID.make(input.id))) || (yield* integrations.get(Integration.ID.make(input.id))))
            return yield* new ConflictError({ resource: input.id, message: `Provider already exists: ${input.id}` })
          yield* requireConnectable(Integration.ID.make(input.id))
          const config = yield* Config.Service
          if (!config.provider) return yield* Effect.die(new Error("Config updates are unavailable"))
          yield* config
            .provider(input.id, {
              name: input.name,
              package: input.package,
              settings: { baseURL: input.baseURL },
              headers: input.headers,
              models: Object.fromEntries(input.models.map((model) => [model.id, { name: model.name }])),
            })
            .pipe(Effect.orDie)
          if (input.apiKey) {
            const credentials = yield* Credential.Service
            yield* credentials.create({
              integrationID: Integration.ID.make(input.id),
              label: input.name,
              value: { type: "key", key: input.apiKey },
            })
          }
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
