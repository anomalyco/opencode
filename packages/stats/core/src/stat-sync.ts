import { DateTime, Effect } from "effect"
import { Resource } from "sst/resource"
import { Athena, AthenaQueryError, AthenaQueryTimeoutError } from "./athena"
import { DatabaseError } from "./database"
import { GeoStatRepo, rowsFromAggregates as geoRowsFromAggregates } from "./domain/geo"
import { buildStatsQuery, toGeoAggregate, toModelAggregate, toProviderAggregate } from "./domain/inference"
import { ModelStatRepo, rowsFromAggregates as modelRowsFromAggregates } from "./domain/model"
import { ProviderStatRepo, rowsFromAggregates as providerRowsFromAggregates } from "./domain/provider"
import { startOfIsoWeek } from "./domain/stat"

const DATALAKE_INGESTION_LAG_MS = 5 * 60_000
const STATS_DATA_START_MS = new Date("2026-05-28T00:00:00.000Z").getTime()
const WEEK_MS = 7 * 86_400_000
const DISPLAY_WINDOW_MS = 56 * 86_400_000
// Anchor incremental passes to the ISO week containing this lookback, so the pass
// after a week boundary still recomputes the previous week's final aggregates even
// if the boundary pass itself failed.
const INCREMENTAL_LOOKBACK_MS = 2 * 3_600_000

export type SyncStatsResult = { ok: true; rows: number; startedAt: string; periodStart: string; periodEnd: string }
export type SyncStatsError = AthenaQueryError | AthenaQueryTimeoutError | DatabaseError

export const syncStats: (options?: {
  full?: boolean
}) => Effect.Effect<SyncStatsResult, SyncStatsError, Athena | ModelStatRepo | ProviderStatRepo | GeoStatRepo> =
  Effect.fn("StatSync.sync")(function* (options?: { full?: boolean }) {
    const startedAt = yield* DateTime.nowAsDate
    const periodEnd = new Date(Math.floor((startedAt.getTime() - DATALAKE_INGESTION_LAG_MS) / 60_000) * 60_000)
    const periodStart = options?.full ? fullPeriodStart(periodEnd) : incrementalPeriodStart(periodEnd)
    const athena = yield* Athena
    const modelStats = yield* ModelStatRepo
    const providerStats = yield* ProviderStatRepo
    const geoStats = yield* GeoStatRepo

    yield* logRuntimeCheck()

    const rows = yield* athena.query(buildStatsQuery(periodStart, periodEnd))
    const modelRows = modelRowsFromAggregates(rows.filter((row) => row.dimension === "model").flatMap(toModelAggregate))
    const providerRows = providerRowsFromAggregates(
      rows.filter((row) => row.dimension === "provider").flatMap(toProviderAggregate),
    )
    const geoRows = geoRowsFromAggregates(
      rows.filter((row) => row.dimension === "geo" || row.dimension === "geo_model").flatMap(toGeoAggregate),
    )

    yield* Effect.all([modelStats.upsert(modelRows), providerStats.upsert(providerRows), geoStats.upsert(geoRows)], {
      concurrency: "unbounded",
      discard: true,
    })
    yield* Effect.all(
      [
        modelStats.deleteRetiredDimensions(modelRows),
        providerStats.deleteRetiredDimensions(providerRows),
        geoStats.deleteRetiredDimensions(geoRows),
      ],
      { concurrency: "unbounded", discard: true },
    )

    yield* Effect.logInfo(
      `stats sync complete ${JSON.stringify({
        startedAt: startedAt.toISOString(),
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        rows: modelRows.length,
        providerRows: providerRows.length,
        geoRows: geoRows.length,
        stage: Resource.App.stage,
      })}`,
    )

    return {
      ok: true,
      rows: modelRows.length,
      startedAt: startedAt.toISOString(),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    }
  })

// May 27 was partial, so keep Athena stats anchored at the first complete day.
function fullPeriodStart(periodEnd: Date) {
  return new Date(
    Math.max(
      Math.min(startOfIsoWeek(periodEnd).getTime() - WEEK_MS, periodEnd.getTime() - DISPLAY_WINDOW_MS),
      STATS_DATA_START_MS,
    ),
  )
}

// Events are append-only, so completed periods never change once synced; hourly
// passes only recompute the periods the current ISO week can still touch. The daily
// full pass refreshes the whole display window (normalization changes, retired
// dimension cleanup).
function incrementalPeriodStart(periodEnd: Date) {
  return new Date(
    Math.max(startOfIsoWeek(new Date(periodEnd.getTime() - INCREMENTAL_LOOKBACK_MS)).getTime(), STATS_DATA_START_MS),
  )
}

function logRuntimeCheck() {
  return Effect.logInfo(
    `athena stats runtime check ${JSON.stringify({
      catalog: Resource.InferenceEvent.catalog,
      database: Resource.InferenceEvent.database,
      dataset: Resource.StatsSyncConfig.dataset,
      table: Resource.InferenceEvent.table,
      workgroup: Resource.InferenceEvent.workgroup,
      region: Resource.InferenceEvent.region,
      stage: Resource.App.stage,
    })}`,
  )
}
