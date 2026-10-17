import { Model } from "@opencode/core/model"
import { ModelsDev } from "@opencode/core/models-dev"
import { ServiceUnavailableError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, response } from "../location"

export const ModelHandler = HttpApiBuilder.group(Api, "server.model", (handlers) =>
  Effect.gen(function* () {
    const modelsDev = yield* ModelsDev.Service
    return handlers
      .handle(
        "model.list",
        Effect.fn(function* () {
          yield* awaitPlugins
          const models = yield* Model.Service
          return yield* response(models.available())
        }),
      )
      .handle(
        "model.refresh",
        Effect.fn(function* () {
          const models = yield* Model.Service
          // Capture the current model list before the refresh. When the refresh actually re-fetches
          // and republishes models.dev the plugin reloads providers/models asynchronously on the
          // Refreshed event; we must wait for that reload to land before replying so the response
          // isn't a stale list. A failed fetch/decode surfaces as ServiceUnavailable so the user
          // knows the cache was not refreshed.
          const before = yield* fingerprint(models)
          const republished = yield* modelsDev.refresh(true).pipe(
            Effect.mapError(
              () =>
                new ServiceUnavailableError({
                  message: "Failed to refresh models from models.dev",
                  service: "model",
                }),
            ),
          )
          yield* awaitPlugins
          if (republished) {
            yield* waitForReload(before, models)
          }
          return yield* response(models.available())
        }),
      )
      .handle(
        "model.default",
        Effect.fn(function* () {
          yield* awaitPlugins
          const models = yield* Model.Service
          return yield* response(models.default())
        }),
      )
  }),
)

const fingerprint = (models: Model.Interface) =>
  Effect.map(models.available(), (infos) =>
    infos
      .map((info) => `${info.providerID}/${info.id}`)
      .sort()
      .join("|"),
  )

// After a republish the models.dev plugin reloads providers/models on the Refreshed event. Poll
// Model.available() until it differs from the pre-refresh fingerprint (bounded, ~5s). If the new
// catalog is byte-identical the reload is a no-op and we fall through to the timeout; the current
// list is still correct in that case.
const waitForReload = (before: string, models: Model.Interface) =>
  Effect.gen(function* () {
    for (let i = 0; i < 200; i++) {
      const now = yield* fingerprint(models)
      if (now !== before) return
      yield* Effect.sleep("25 millis")
    }
  }).pipe(Effect.ignore)
