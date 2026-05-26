import { and, asc, eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { DatabaseError, DrizzleClient } from "../database"
import { geoStat } from "../database/schema"
import {
  chunks,
  collapseRows,
  inserted,
  rankRowsWithMarketShare,
  synthesizeAllTierRows,
  toStatBaseRow,
  UPSERT_CHUNK_SIZE,
  type StatBaseAggregate,
} from "./stat"

export type GeoStatRow = typeof geoStat.$inferInsert
export type GeoStatAggregate = StatBaseAggregate & { country: string; continent: string }
export type GeoStatMetric = {
  periodStart: Date
  periodEnd: Date
  tier: string
  country: string
  continent: string
  totalTokens: number
}

export declare namespace GeoStatRepo {
  export interface Service {
    readonly listDaily: () => Effect.Effect<GeoStatMetric[], DatabaseError>
    readonly listByPeriod: (opts: {
      readonly grain: string
      readonly periodStart: Date
      readonly dataset?: string
      readonly tier?: string
      readonly client?: string
      readonly source?: string
    }) => Effect.Effect<GeoStatRow[], DatabaseError>
    readonly upsert: (rows: GeoStatRow[]) => Effect.Effect<void, DatabaseError>
  }
}

export class GeoStatRepo extends Context.Service<GeoStatRepo, GeoStatRepo.Service>()("@opencode/stats/GeoStatRepo") {
  static readonly layer: Layer.Layer<GeoStatRepo, never, DrizzleClient> = Layer.effect(
    GeoStatRepo,
    Effect.gen(function* () {
      const db = yield* DrizzleClient

      const listDaily = Effect.fn("GeoStatRepo.listDaily")(function* () {
        return yield* Effect.tryPromise({
          try: () =>
            db
              .select({
                periodStart: geoStat.period_start,
                periodEnd: geoStat.period_end,
                tier: geoStat.tier,
                country: geoStat.country,
                continent: geoStat.continent,
                totalTokens: geoStat.total_tokens,
              })
              .from(geoStat)
              .where(and(eq(geoStat.grain, "day"), eq(geoStat.client, "all"), eq(geoStat.source, "all")))
              .orderBy(asc(geoStat.period_start)),
          catch: (cause) => DatabaseError.make({ cause }),
        })
      })

      const listByPeriod = Effect.fn("GeoStatRepo.listByPeriod")(function* (opts: {
        readonly grain: string
        readonly periodStart: Date
        readonly dataset?: string
        readonly tier?: string
        readonly client?: string
        readonly source?: string
      }) {
        return yield* Effect.tryPromise({
          try: () =>
            db
              .select()
              .from(geoStat)
              .where(
                and(
                  eq(geoStat.grain, opts.grain),
                  eq(geoStat.period_start, opts.periodStart),
                  eq(geoStat.dataset, opts.dataset ?? "zen"),
                  eq(geoStat.tier, opts.tier ?? "all"),
                  eq(geoStat.client, opts.client ?? "all"),
                  eq(geoStat.source, opts.source ?? "all"),
                ),
              ),
          catch: (cause) => DatabaseError.make({ cause }),
        })
      })

      const upsert = Effect.fn("GeoStatRepo.upsert")(function* (rows: GeoStatRow[]) {
        yield* Effect.forEach(
          chunks(rows, UPSERT_CHUNK_SIZE),
          (chunk) =>
            Effect.tryPromise({
              try: () =>
                db
                  .insert(geoStat)
                  .values(chunk)
                  .onDuplicateKeyUpdate({
                    set: {
                      period_end: inserted("period_end"),
                      continent: inserted("continent"),
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

      return GeoStatRepo.of({ listDaily, listByPeriod, upsert })
    }),
  )
}

export function rowsFromAggregates(aggregates: GeoStatAggregate[]) {
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

function toRow(data: GeoStatAggregate): GeoStatRow {
  return {
    ...toStatBaseRow(data),
    country: data.country,
    continent: data.continent,
  }
}

function dimensionKey(row: GeoStatRow) {
  return row.country
}
