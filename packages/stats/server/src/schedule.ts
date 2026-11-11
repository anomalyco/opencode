// Keep in sync with the schedules in services/data/sync.config.ts.
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

// The newest IDs of the same kind a run may still be using, starting with this
// slot's own. Hourly and history runs cover different periods and their writes
// are idempotent, so one kind never waits for the other.
export function recentInstanceIds(scheduledAt: Date, history: boolean) {
  return Array.from({ length: history ? HISTORY_LOOKBACK : HOURLY_LOOKBACK }, (_, index) =>
    instanceId(new Date(scheduledAt.getTime() - index * (history ? DAY_MS : HOUR_MS)), history),
  )
}

// Runs of one kind never overlap: two would repeat R2 SQL spend for the same
// periods. `undefined` means the instance does not exist.
export function skipReason(id: string, instances: { id: string; status: string | undefined }[]) {
  const own = instances.find((instance) => instance.id === id && instance.status !== undefined)
  if (own) return { reason: "already created", instance: own.id, status: own.status }
  const active = instances.find((instance) => instance.status !== undefined && ACTIVE.has(instance.status))
  if (active) return { reason: "previous run active", instance: active.id, status: active.status }
}

// Workflow bindings reject with plain Errors whose message carries the code, as
// "instance.not_found" or "(instance.already_exists) Instance already exists".
export function isWorkflowError(error: unknown, code: "instance.not_found" | "instance.already_exists") {
  return error instanceof Error && error.message.includes(code)
}
