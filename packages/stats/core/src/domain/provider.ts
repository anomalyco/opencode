import { and, asc, eq, inArray } from "drizzle-orm"
import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { DatabaseError, DrizzleClient } from "../database"
import { providerStat } from "../database/schema"
import { RETIRED_STAT_PROVIDERS } from "./model-normalization"
import {
  chunks,
  collapseRows,
  inserted,
  rankRowsWithMarketShare,
  statRowScope,
  synthesizeAllTierRows,
  toStatBaseRow,
  UPSERT_CHUNK_SIZE,
  type StatBaseAggregate,
} from "./stat"

export type ProviderStatRow = typeof providerStat.$inferInsert
export type ProviderStatAggregate = StatBaseAggregate & { provider: string }
export type ProviderStatMetric = {
  periodKey: string
  updatedAt: Date
  tier: string
  provider: string
  totalTokens: number
}

export declare namespace ProviderStatRepo {
  export interface Service {
    readonly listDaily: () => Effect.Effect<ProviderStatMetric[], DatabaseError>
    readonly listByPeriod: (opts: {
      readonly grain: string
      readonly periodKey: string
      readonly dataset?: string
      readonly tier?: string
      readonly client?: string
      readonly source?: string
    }) => Effect.Effect<ProviderStatRow[], DatabaseError>
    readonly upsert: (rows: ProviderStatRow[]) => Effect.Effect<void, DatabaseError>
    readonly deleteRetiredDimensions: (rows: ProviderStatRow[]) => Effect.Effect<void, DatabaseError>
  }
}

export class ProviderStatRepo extends Context.Service<ProviderStatRepo, ProviderStatRepo.Service>()(
  "@opencode/stats/ProviderStatRepo",
) {
  static readonly layer: Layer.Layer<ProviderStatRepo, never, DrizzleClient> = Layer.effect(
    ProviderStatRepo,
    Effect.gen(function* () {
      const db = yield* DrizzleClient

      const listDaily = Effect.fn("ProviderStatRepo.listDaily")(function* () {
        return yield* Effect.tryPromise({
          try: () =>
            db
              .select({
                periodKey: providerStat.period_key,
                updatedAt: providerStat.updated_at,
                tier: providerStat.tier,
                provider: providerStat.provider,
                totalTokens: providerStat.total_tokens,
              })
              .from(providerStat)
              .where(and(eq(providerStat.grain, "day"), eq(providerStat.client, "all"), eq(providerStat.source, "all")))
              .orderBy(asc(providerStat.period_key)),
          catch: (cause) => DatabaseError.make({ cause }),
        })
      })

      const listByPeriod = Effect.fn("ProviderStatRepo.listByPeriod")(function* (opts: {
        readonly grain: string
        readonly periodKey: string
        readonly dataset?: string
        readonly tier?: string
        readonly client?: string
        readonly source?: string
      }) {
        return yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(providerStat)
              .where(
                and(
                  eq(providerStat.grain, opts.grain),
                  eq(providerStat.period_key, opts.periodKey),
                  eq(providerStat.dataset, opts.dataset ?? "zen"),
                  eq(providerStat.tier, opts.tier ?? "all"),
                  eq(providerStat.client, opts.client ?? "all"),
                  eq(providerStat.source, opts.source ?? "all"),
                ),
              ),
          catch: (cause) => DatabaseError.make({ cause }),
        })
      })

      const upsert = Effect.fn("ProviderStatRepo.upsert")(function* (rows: ProviderStatRow[]) {
        yield* Effect.forEach(
          chunks(rows, UPSERT_CHUNK_SIZE),
          (chunk) =>
            Effect.tryPromise({
              try: () =>
                db
                  .insert(providerStat)
                  .values(chunk)
                  .onDuplicateKeyUpdate({
                    set: {
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
                      market_share_tokens: inserted("market_share_tokens"),
                      market_share_requests: inserted("market_share_requests"),
                      market_share_sessions: inserted("market_share_sessions"),
                      rank_by_tokens: inserted("rank_by_tokens"),
                      rank_by_requests: inserted("rank_by_requests"),
                      rank_by_sessions: inserted("rank_by_sessions"),
                      rank_by_cost: inserted("rank_by_cost"),
                    },
                  }),
              catch: (cause) => DatabaseError.make({ cause }),
            }),
          { discard: true },
        )
      })

      const deleteRetiredDimensions = Effect.fn("ProviderStatRepo.deleteRetiredDimensions")(function* (
        rows: ProviderStatRow[],
      ) {
        const scope = statRowScope(rows)
        if (!scope) return

        yield* Effect.tryPromise({
          try: () =>
            db
              .delete(providerStat)
              .where(
                and(
                  inArray(providerStat.grain, scope.grains),
                  inArray(providerStat.period_key, scope.periodKeys),
                  inArray(providerStat.dataset, scope.datasets),
                  inArray(providerStat.client, scope.clients),
                  inArray(providerStat.source, scope.sources),
                  inArray(providerStat.provider, RETIRED_STAT_PROVIDERS),
                ),
              ),
          catch: (cause) => DatabaseError.make({ cause }),
        })
      })

      return ProviderStatRepo.of({ listDaily, listByPeriod, upsert, deleteRetiredDimensions })
    }),
  )
}

export function rowsFromAggregates(aggregates: ProviderStatAggregate[]) {
  return rankRowsWithMarketShare([
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

function toRow(data: ProviderStatAggregate): ProviderStatRow {
  return {
    ...toStatBaseRow(data),
    provider: data.provider,
  }
}

function dimensionKey(row: ProviderStatRow) {
  return row.provider
}
