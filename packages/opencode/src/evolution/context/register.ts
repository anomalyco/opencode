import { Effect, Layer, Schema } from "effect"
import { SystemContext } from "@opencode-ai/core/system-context/index"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { Config } from "@/config/config"
import { SystemContextProvider } from "./provider"

const key = SystemContext.Key.make("evolution/context")

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* SystemContextRegistry.Service
    const config = yield* Config.Service
    const data = yield* config.get()
    const cfg = data.evolution ?? {}

    const provider = SystemContextProvider.fromConfig(cfg)

    yield* registry.register({
      key,
      load: provider.provide().pipe(
        Effect.map((text) =>
          SystemContext.make({
            key,
            codec: Schema.toCodecJson(Schema.String),
            load: Effect.succeed(text),
            baseline: (t) => t,
            update: (_prev, curr) => curr,
            removed: () => "Evolution context no longer available.",
          }),
        ),
      ),
    })
  }),
)

export * as EvolutionContextLayer from "./register"