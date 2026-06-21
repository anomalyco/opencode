import { AppConfig } from "@opencode-ai/stats-core/config"
import { layer } from "@opencode-ai/stats-core/database"
import { GeoStatRepo } from "@opencode-ai/stats-core/domain/geo"
import { ModelStatRepo } from "@opencode-ai/stats-core/domain/model"
import { ProviderStatRepo } from "@opencode-ai/stats-core/domain/provider"
import { Effect, Layer } from "effect"
import type { Success } from "effect/Layer"

const repoLayer = Layer.mergeAll(ModelStatRepo.layer, ProviderStatRepo.layer, GeoStatRepo.layer).pipe(
  Layer.provide(layer),
)
const statsLayer = Layer.mergeAll(AppConfig.layer, layer, repoLayer)

export function runStatsEffect<A, E>(effect: Effect.Effect<A, E, Success<typeof statsLayer>>) {
  return Effect.runPromise(Effect.provide(effect, statsLayer))
}
