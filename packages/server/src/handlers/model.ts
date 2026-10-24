import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Duration, Effect, Option } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, response } from "../location"

type SettledModels = {
  readonly available: readonly Model.Info[]
  readonly default: Model.Info | undefined
}

export const ModelHandler = HttpApiBuilder.group(Api, "server.model", (handlers) =>
  Effect.gen(function* () {
    const settled = new WeakMap<Model.Interface, SettledModels>()
    const snapshot = Effect.gen(function* () {
      const models = yield* Model.Service
      const ready = Option.isSome(yield* Effect.timeoutOption(Plugin.awaitActivation, Duration.zero))
      if (!ready) {
        const previous = settled.get(models)
        if (previous) return previous
        const activated = yield* Effect.option(awaitPlugins)
        if (Option.isNone(activated)) {
          return {
            available: yield* models.available(),
            default: yield* models.default(),
          }
        }
      }
      const current: SettledModels = {
        available: yield* models.available(),
        default: yield* models.default(),
      }
      settled.set(models, current)
      return current
    })

    return handlers
      .handle(
        "model.list",
        Effect.fn(function* () {
          const current = yield* snapshot
          return yield* response(Effect.succeed(current.available))
        }),
      )
      .handle(
        "model.default",
        Effect.fn(function* () {
          const current = yield* snapshot
          return yield* response(Effect.succeed(current.default))
        }),
      )
  }),
)
