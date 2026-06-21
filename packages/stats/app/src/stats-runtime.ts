import { AppConfig } from "@opencode-ai/stats-core/config"
import { layer } from "@opencode-ai/stats-core/database"
import { GeoStatRepo } from "@opencode-ai/stats-core/domain/geo"
import { ModelStatRepo } from "@opencode-ai/stats-core/domain/model"
import { ProviderStatRepo } from "@opencode-ai/stats-core/domain/provider"
import { Layer, ManagedRuntime } from "effect"

const repoLayer = Layer.mergeAll(ModelStatRepo.layer, ProviderStatRepo.layer, GeoStatRepo.layer).pipe(
  Layer.provide(layer),
)

export const statsRuntime = ManagedRuntime.make(Layer.mergeAll(AppConfig.layer, layer, repoLayer))
