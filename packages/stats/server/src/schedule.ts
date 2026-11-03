// Keep in sync with the StatsSyncCron schedules in infra/stats.ts.
export const HOURLY_SCHEDULE = "5 * * * *"
export const HISTORY_SCHEDULE = "20 3 * * *"

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
// How far back a run can still be active: hourly runs finish within hours, history
// runs within days.
const HOURLY_LOOKBACK = 6
const HISTORY_LOOKBACK = 3
const ACTIVE = new Set(["queued", "running", "waiting", "paused", "waitingForPause"])

export type StatsSyncParams = { history?: boolean; startedAt?: string }

// One ID per schedule slot, so a repeated trigger cannot start a second run.
export function instanceId(scheduledAt: Date, history: boolean) {
  if (history) return `stats-history-${scheduledAt.toISOString().slice(0, 10)}`
  return `stats-hourly-${scheduledAt.toISOString().slice(0, 13)}`
}

// The newest IDs a run may still be using, starting with this slot's own.
export function recentInstanceIds(scheduledAt: Date) {
  return [
    ...Array.from({ length: HOURLY_LOOKBACK }, (_, index) =>
      instanceId(new Date(scheduledAt.getTime() - index * HOUR_MS), false),
    ),
    ...Array.from({ length: HISTORY_LOOKBACK }, (_, index) =>
      instanceId(new Date(scheduledAt.getTime() - index * DAY_MS), true),
    ),
  ]
}

// Runs never overlap: two runs would repeat R2 SQL spend and race on the same
// rows. `undefined` means the instance does not exist.
export function skipReason(id: string, instances: { id: string; status: string | undefined }[]) {
  const own = instances.find((instance) => instance.id === id && instance.status !== undefined)
  if (own) return { reason: "already created", instance: own.id, status: own.status }
  const active = instances.find((instance) => instance.status !== undefined && ACTIVE.has(instance.status))
  if (active) return { reason: "previous run active", instance: active.id, status: active.status }
}
