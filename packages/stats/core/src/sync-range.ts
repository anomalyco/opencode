import { startOfIsoWeek, startOfUtcDay } from "./domain/stat"

const DATALAKE_INGESTION_LAG_MS = 5 * 60_000
const STATS_DATA_START_MS = new Date("2026-05-28T00:00:00.000Z").getTime()
const WEEK_MS = 7 * 86_400_000
const DISPLAY_WINDOW_MS = 56 * 86_400_000
// A retention result needs one complete activity week plus its complete return
// week. Keep another partial week of slack around the ISO-week boundary.
const RETENTION_INCREMENTAL_LOOKBACK_MS = 16 * 86_400_000
// Anchor incremental passes to the ISO week containing this lookback, so the pass
// after a week boundary still recomputes the previous week's final aggregates even
// if the boundary pass itself failed.
const INCREMENTAL_LOOKBACK_MS = 2 * 3_600_000

// Events are append-only, so completed periods never change once synced. Hourly
// incremental passes recompute only the periods the current ISO week can still
// touch and the latest retention cohorts. The daily history pass recomputes the rest
// of the display window (normalization changes, retired dimension cleanup). The two
// never share a period or cohort, so the slow history pass can run beside them.
export function syncRange(startedAt: Date, history = false) {
  const periodEnd = new Date(Math.floor((startedAt.getTime() - DATALAKE_INGESTION_LAG_MS) / 60_000) * 60_000)
  const incrementalStart = incrementalPeriodStart(periodEnd)
  const retentionEnd = startOfUtcDay(periodEnd)
  const retentionStart = new Date(
    Math.max(retentionEnd.getTime() - RETENTION_INCREMENTAL_LOOKBACK_MS, STATS_DATA_START_MS),
  )
  if (!history) return { periodStart: incrementalStart, periodEnd, retentionStart, retentionEnd }
  const windowStart = displayWindowStart(periodEnd)
  return {
    periodStart: windowStart,
    periodEnd: incrementalStart,
    retentionStart: windowStart,
    // A cohort is computed only once its return week ends by this bound, so history
    // stops one cohort before the first one the incremental pass recomputes.
    retentionEnd: new Date(startOfIsoWeek(retentionStart).getTime() + WEEK_MS),
  }
}

// May 27 was partial, so keep stats anchored at the first complete day.
function displayWindowStart(periodEnd: Date) {
  return new Date(
    Math.max(
      Math.min(startOfIsoWeek(periodEnd).getTime() - WEEK_MS, periodEnd.getTime() - DISPLAY_WINDOW_MS),
      STATS_DATA_START_MS,
    ),
  )
}

function incrementalPeriodStart(periodEnd: Date) {
  return new Date(
    Math.max(startOfIsoWeek(new Date(periodEnd.getTime() - INCREMENTAL_LOOKBACK_MS)).getTime(), STATS_DATA_START_MS),
  )
}
