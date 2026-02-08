/**
 * Models.dev provider data (build-time embedded)
 *
 * To refresh: npx tsx scripts/fetch-models.ts
 */
import modelsJson from "../generated/models-data.json" with { type: "json" }
import type { ModelsData, ModelsDevProvider, ModelsDevModel } from "../generated/models-types.ts"

export type { ModelsData, ModelsDevProvider, ModelsDevModel }

const typedData = modelsJson as { _generatedAt: string; _source: string; data: ModelsData }

/**
 * Get providers from build-time embedded data
 */
export function getModelsDevProviders(): ModelsData {
  return typedData.data
}

/**
 * Get the timestamp when models data was generated
 */
export function getModelsGeneratedAt(): string {
  return typedData._generatedAt
}
