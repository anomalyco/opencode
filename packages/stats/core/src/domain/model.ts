import { and, asc, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { DatabaseError, DrizzleClient } from "../database"
import { modelStat } from "../database/schema"
import {
  chunks,
  collapseRows,
  inserted,
  rankBy,
  statPeriodKey,
  synthesizeAllTierRows,
  toStatBaseRow,
  UPSERT_CHUNK_SIZE,
  type StatBaseAggregate,
} from "./stat"

export type ModelStatRow = typeof modelStat.$inferInsert
export type ModelStatAggregate = StatBaseAggregate & { provider: string; model: string; provider_model: string }

export type ModelStatMetric = {
  periodKey: string
  updatedAt: Date
  tier: string
  provider: string
  model: string
  sessions: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  totalTokens: number
  inputCostMicrocents: number
  outputCostMicrocents: number
  totalCostMicrocents: number
}

export declare namespace ModelStatRepo {
  export interface Service {
    readonly listDaily: () => Effect.Effect<ModelStatMetric[], DatabaseError>
    readonly upsert: (rows: ModelStatRow[]) => Effect.Effect<void, DatabaseError>
  }
}

export class ModelStatRepo extends Context.Service<ModelStatRepo, ModelStatRepo.Service>()(
  "@opencode/stats/ModelStatRepo",
) {
  static readonly layer: Layer.Layer<ModelStatRepo, never, DrizzleClient> = Layer.effect(
    ModelStatRepo,
    Effect.gen(function* () {
      const db = yield* DrizzleClient

      const listDaily = Effect.fn("ModelStatRepo.listDaily")(function* () {
        return yield* Effect.tryPromise({
          try: () =>
            db
              .select({
                periodKey: modelStat.period_key,
                updatedAt: modelStat.updated_at,
                tier: modelStat.tier,
                provider: modelStat.provider,
                model: modelStat.model,
                sessions: modelStat.sessions,
                inputTokens: modelStat.input_tokens,
                outputTokens: modelStat.output_tokens,
                reasoningTokens: modelStat.reasoning_tokens,
                cacheReadTokens: modelStat.cache_read_tokens,
                totalTokens: modelStat.total_tokens,
                inputCostMicrocents: modelStat.input_cost_microcents,
                outputCostMicrocents: modelStat.output_cost_microcents,
                totalCostMicrocents: modelStat.total_cost_microcents,
              })
              .from(modelStat)
              .where(and(eq(modelStat.grain, "day"), eq(modelStat.client, "all"), eq(modelStat.source, "all")))
              .orderBy(asc(modelStat.period_key)),
          catch: (cause) => DatabaseError.make({ cause }),
        })
      })

      const upsert = Effect.fn("ModelStatRepo.upsert")(function* (rows: ModelStatRow[]) {
        yield* Effect.forEach(
          chunks(rows, UPSERT_CHUNK_SIZE),
          (chunk) =>
            Effect.tryPromise({
              try: () =>
                db
                  .insert(modelStat)
                  .values(chunk)
                  .onDuplicateKeyUpdate({
                    set: {
                      provider_model: inserted("provider_model"),
                      sessions: inserted("sessions"),
                      requests: inserted("requests"),
                      input_tokens: inserted("input_tokens"),
                      output_tokens: inserted("output_tokens"),
                      reasoning_tokens: inserted("reasoning_tokens"),
                      cache_read_tokens: inserted("cache_read_tokens"),
                      total_tokens: inserted("total_tokens"),
                      input_cost_microcents: inserted("input_cost_microcents"),
                      output_cost_microcents: inserted("output_cost_microcents"),
                      total_cost_microcents: inserted("total_cost_microcents"),
                      avg_duration_ms: inserted("avg_duration_ms"),
                      p50_duration_ms: inserted("p50_duration_ms"),
                      p95_duration_ms: inserted("p95_duration_ms"),
                      avg_ttfb_ms: inserted("avg_ttfb_ms"),
                      p50_ttfb_ms: inserted("p50_ttfb_ms"),
                      p95_ttfb_ms: inserted("p95_ttfb_ms"),
                      avg_output_tps: inserted("avg_output_tps"),
                      success_count: inserted("success_count"),
                      error_count: inserted("error_count"),
                      sample_count: inserted("sample_count"),
                      rank_by_tokens: inserted("rank_by_tokens"),
                      rank_by_requests: inserted("rank_by_requests"),
                      rank_by_cost: inserted("rank_by_cost"),
                    },
                  }),
              catch: (cause) => DatabaseError.make({ cause }),
            }),
          { discard: true },
        )
      })

      return ModelStatRepo.of({ listDaily, upsert })
    }),
  )
}

export function rowsFromAggregates(aggregates: ModelStatAggregate[]) {
  return rankRows([
    ...synthesizeAllTierRows(
      collapseRows(aggregates.filter((item) => item.grain === "week").map(toRow), dimensionKey),
      dimensionKey,
    ),
    ...synthesizeAllTierRows(
      collapseRows(aggregates.filter((item) => item.grain === "day").map(toRow), dimensionKey),
      dimensionKey,
    ),
  ])
}

function toRow(data: ModelStatAggregate): ModelStatRow {
  return {
    ...toStatBaseRow(data),
    provider: data.provider,
    model: data.model,
    provider_model: data.provider_model,
  }
}

function rankRows(rows: ModelStatRow[]) {
  return Object.values(
    rows.reduce<Record<string, ModelStatRow[]>>((result, row) => {
      const key = statPeriodKey(row)
      result[key] = [...(result[key] ?? []), row]
      return result
    }, {}),
  ).flatMap((group) => {
    const tokenRanks = rankBy(group, (row) => row.total_tokens ?? 0)
    const requestRanks = rankBy(group, (row) => row.requests ?? 0)
    const costRanks = rankBy(group, (row) => row.total_cost_microcents ?? 0)
    return group.map((row) => ({
      ...row,
      rank_by_tokens: tokenRanks.get(row) ?? null,
      rank_by_requests: requestRanks.get(row) ?? null,
      rank_by_cost: costRanks.get(row) ?? null,
    }))
  })
}

function dimensionKey(row: ModelStatRow) {
  return [row.provider, row.model].join("\u0000")
}
