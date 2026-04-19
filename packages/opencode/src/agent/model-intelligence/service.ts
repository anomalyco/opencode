import { Effect, Layer, Context, Schema } from "effect"
import {
  EffortTier,
  SelectionRequest as SelectionRequestSchema,
  SelectionResult as SelectionResultSchema,
  BenchmarkDatabase,
  BenchmarkEntry as BenchmarkEntrySchema,
  EffectiveCost as EffectiveCostSchema,
} from "./types"
import { calculateEffectiveCost, filterPaidModels, isFreeToUser } from "./cost"
import { selectModel, getDefaultTierWeights } from "./selector"
import { Log } from "@/util"
import benchmarkData from "./benchmarks.json"

type SelectionRequest = Schema.Schema.Type<typeof SelectionRequestSchema>
type SelectionResult = Schema.Schema.Type<typeof SelectionResultSchema>
type BenchmarkEntry = Schema.Schema.Type<typeof BenchmarkEntrySchema>
type EffectiveCost = Schema.Schema.Type<typeof EffectiveCostSchema>

const log = Log.create({ service: "model-intelligence" })

type CostInfo = {
  readonly is_free: boolean
  readonly output_per_1m: number
}

export interface Interface {
  readonly select: (request: SelectionRequest) => Effect.Effect<SelectionResult, Error>
  readonly listModels: () => Effect.Effect<ReadonlyArray<BenchmarkEntry & { key: string }>, never>
  readonly getEffectiveCost: (
    providerId: string,
    modelId: string,
  ) => Effect.Effect<EffectiveCost, never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelIntelligence") {}

function buildCandidateKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}

function findMatchingEntry(
  providerId: string,
  modelId: string,
): BenchmarkEntry | undefined {
  const exact = buildCandidateKey(providerId, modelId)
  const models = benchmarkData.models as Record<string, BenchmarkEntry>
  if (models[exact]) return models[exact]

  for (const [key, entry] of Object.entries(models)) {
    if (entry.provider === providerId && entry.id === modelId) return entry
    if (entry.provider === providerId && modelId.startsWith(entry.id)) return entry
  }

  return undefined
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = benchmarkData as unknown as {
      version: string
      updated: string
      models: Record<string, BenchmarkEntry>
    }

    const select = Effect.fn("ModelIntelligence.select")(
      function* (request: SelectionRequest): SelectionResult {
        const candidates = new Map<string, BenchmarkEntry>()
        const effectiveCosts = new Map<string, CostInfo>()

        const filtered = yield* filterPaidModels(
          request.available_models,
          request.no_paid_apis,
        )

        for (const model of filtered) {
          const entry = findMatchingEntry(model.provider_id, model.model_id)
          if (!entry) continue

          const key = buildCandidateKey(model.provider_id, model.model_id)
          candidates.set(key, entry)

          const cost = yield* calculateEffectiveCost(model.provider_id, model.model_id, entry.cost)
          effectiveCosts.set(key, {
            is_free: cost.is_free,
            output_per_1m: cost.output_per_1m,
          })
        }

        if (candidates.size === 0) {
          log.info("no benchmark-matched candidates found, returning empty result")
          return {
            provider_id: "",
            model_id: "",
            score: 0,
            reason: "No models with benchmark data matched your connected providers",
            tier: request.tier,
            effective_cost: "unknown",
          }
        }

        const result = yield* selectModel(candidates, request, effectiveCosts)

        log.info("selected model", {
          provider: result.provider_id,
          model: result.model_id,
          tier: result.tier,
          score: result.score,
          cost: result.effective_cost,
        })

        return result
      },
    )

    const listModels = Effect.fn("ModelIntelligence.listModels")(
      function* () {
        return Object.entries(db.models).map(([key, entry]) => ({ ...entry, key }))
      },
    )

    const getEffectiveCost = Effect.fn("ModelIntelligence.getEffectiveCost")(
      function* (providerId: string, modelId: string) {
        const entry = findMatchingEntry(providerId, modelId)
        const publishedCost = entry?.cost ?? { input_per_1m: 0, output_per_1m: 0 }
        return yield* calculateEffectiveCost(providerId, modelId, publishedCost)
      },
    )

    return Service.of({ select, listModels, getEffectiveCost })
  }),
)

export { getDefaultTierWeights }
export type { EffortTier, SelectionRequest, SelectionResult }
