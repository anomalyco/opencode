import { Config } from "@opencode-ai/core/config"
import { Effect, Layer } from "effect"

/** Config service backed by a single document with the given fields. */
export const configLayer = (info: Partial<Config.Info> = {}) =>
  Layer.succeed(
    Config.Service,
    Config.Service.of({
      entries: () => Effect.succeed([new Config.Document({ type: "document", info: new Config.Info(info) })]),
    }),
  )
