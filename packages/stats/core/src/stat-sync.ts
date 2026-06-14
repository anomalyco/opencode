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

export type SyncStatsResult = { ok: true; rows: number; startedAt: string; periodStart: string; periodEnd: string }
export type SyncStatsError = AthenaQueryError | AthenaQueryTimeoutError | DatabaseError

export const syncStats: () => Effect.Effect<
  SyncStatsResult,
  SyncStatsError,
  Athena | ModelStatRepo | ProviderStatRepo | GeoStatRepo
> = Effect.fn("StatSync.sync")(function* () {
  const startedAt = yield* DateTime.nowAsDate
  const periodEnd = new Date(Math.floor((startedAt.getTime() - DATALAKE_INGESTION_LAG_MS) / 60_000) * 60_000)
  // May 27 was partial, so keep Athena stats anchored at the first complete day.
  const periodStart = new Date(Math.max(startOfIsoWeek(periodEnd).getTime() - WEEK_MS, STATS_DATA_START_MS))
  const athena = yield* Athena
  const modelStats = yield* ModelStatRepo
  const providerStats = yield* ProviderStatRepo
  const geoStats = yield* GeoStatRepo

  yield* logRuntimeCheck()

  const [modelAggregates, providerAggregates, geoAggregates, geoModelAggregates] = yield* Effect.all(
    [
      athena
        .query(buildStatsQuery(periodStart, periodEnd, "model"))
        .pipe(Effect.map((rows) => rows.flatMap(toModelAggregate))),
      athena
        .query(buildStatsQuery(periodStart, periodEnd, "provider"))
        .pipe(Effect.map((rows) => rows.flatMap(toProviderAggregate))),
      athena
        .query(buildStatsQuery(periodStart, periodEnd, "geo"))
        .pipe(Effect.map((rows) => rows.flatMap(toGeoAggregate))),
      athena
        .query(buildStatsQuery(periodStart, periodEnd, "geo_model"))
        .pipe(Effect.map((rows) => rows.flatMap(toGeoAggregate))),
    ],
    { concurrency: "unbounded" },
  )
  const modelRows = modelRowsFromAggregates(modelAggregates)
  const providerRows = providerRowsFromAggregates(providerAggregates)
  const geoRows = geoRowsFromAggregates([...geoAggregates, ...geoModelAggregates])

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
