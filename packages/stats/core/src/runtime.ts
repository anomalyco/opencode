import { Layer, ManagedRuntime } from "effect"
import { AppConfig } from "./config"
import { layer as databaseLayer } from "./database"
import { GeoStatRepo } from "./domain/geo"
import { ModelStatRepo } from "./domain/model"
import { ProviderStatRepo } from "./domain/provider"

const repoLayer = Layer.mergeAll(ModelStatRepo.layer, ProviderStatRepo.layer, GeoStatRepo.layer).pipe(
  Layer.provide(databaseLayer),
)

export const layer = Layer.mergeAll(AppConfig.layer, databaseLayer, repoLayer)
export const runtime = ManagedRuntime.make(layer)
export type RuntimeServices = ManagedRuntime.ManagedRuntime.Services<typeof runtime>
