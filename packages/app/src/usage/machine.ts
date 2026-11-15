import type { UsageLimitsInfo } from "@opencode/client/promise"

/** How long one load of the usage limits may run before the dialog offers Try again. */
export const USAGE_LOAD_TIMEOUT_MS = 15_000

/** What a finished load found: limits, or an explicit signed-out answer. */
export type UsageLoadOutcome =
  | { readonly kind: "limits"; readonly info: UsageLimitsInfo }
  | { readonly kind: "signed-out" }

/**
 * The Usage dialog's load of one location's limits. `key` names the location; attempts come from `issued`, so a load
 * whose attempt the state no longer holds is stale. `refreshing` shows limits cached earlier while the dialog's own
 * load runs.
 */
export type UsageDialogState =
  | { readonly status: "loading"; readonly issued: number; readonly attempt: number; readonly key: string }
  | {
      readonly status: "refreshing"
      readonly issued: number
      readonly attempt: number
      readonly key: string
      readonly info: UsageLimitsInfo
    }
  | { readonly status: "ready"; readonly issued: number; readonly key: string; readonly info: UsageLimitsInfo }
  | { readonly status: "signed-out"; readonly issued: number; readonly key: string }
  | { readonly status: "failed"; readonly issued: number; readonly key: string }
  | { readonly status: "disposed" }

export type UsageDialogEvent =
  /** The dialog moved to another location; `cached` is what the cache holds for it. */
  | { readonly type: "location.changed"; readonly key: string; readonly cached: UsageLimitsInfo | null | undefined }
  | { readonly type: "load.succeeded"; readonly attempt: number; readonly outcome: UsageLoadOutcome }
  | { readonly type: "load.failed"; readonly attempt: number }
  | { readonly type: "load.timed-out"; readonly attempt: number }
  /** The shared cache changed, for example from a session's usage event. `undefined` means not known. */
  | { readonly type: "cache.synced"; readonly key: string; readonly limits: UsageLimitsInfo | null | undefined }
  | { readonly type: "retry" }
  | { readonly type: "disposed" }

export type UsageDialogEffect =
  /** Invalidates and loads the location's limits. */
  | { readonly type: "sync"; readonly attempt: number; readonly key: string }
  | { readonly type: "timer.start"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "timer.stop" }

export type UsageDialogTransition = { readonly state: UsageDialogState; readonly effects: readonly UsageDialogEffect[] }

export type UsageDialogView =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly info: UsageLimitsInfo; readonly refreshing: boolean }
  | { readonly status: "signed-out" }
  | { readonly status: "failed" }

const NONE: readonly UsageDialogEffect[] = []

export function startUsageDialog(input: {
  key: string
  cached: UsageLimitsInfo | null | undefined
}): UsageDialogTransition {
  return load({ issued: 0, key: input.key, cached: input.cached })
}

export function transitionUsageDialog(state: UsageDialogState, event: UsageDialogEvent): UsageDialogTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: state.status === "loading" || state.status === "refreshing" ? [{ type: "timer.stop" }] : NONE,
    }

  if (event.type === "location.changed") {
    if (event.key === state.key) return { state, effects: NONE }
    const next = load({ issued: state.issued, key: event.key, cached: event.cached })

    return {
      state: next.state,
      effects:
        state.status === "loading" || state.status === "refreshing"
          ? [{ type: "timer.stop" }, ...next.effects]
          : next.effects,
    }
  }

  if (event.type === "retry") {
    if (state.status !== "failed") return { state, effects: NONE }

    return load({ issued: state.issued, key: state.key, cached: undefined })
  }

  if (event.type === "cache.synced") return synced(state, event)

  if (state.status !== "loading" && state.status !== "refreshing") return { state, effects: NONE }

  if (event.attempt !== state.attempt) return { state, effects: NONE }
  const stop: readonly UsageDialogEffect[] = [{ type: "timer.stop" }]

  if (event.type !== "load.succeeded")
    return { state: { status: "failed", issued: state.issued, key: state.key }, effects: stop }

  if (event.outcome.kind === "signed-out")
    return { state: { status: "signed-out", issued: state.issued, key: state.key }, effects: stop }

  return { state: { status: "ready", issued: state.issued, key: state.key, info: event.outcome.info }, effects: stop }
}

export function selectUsageDialogView(state: UsageDialogState): UsageDialogView {
  if (state.status === "refreshing") return { status: "ready", info: state.info, refreshing: true }

  if (state.status === "ready") return { status: "ready", info: state.info, refreshing: false }

  if (state.status === "signed-out" || state.status === "failed") return { status: state.status }

  return { status: "loading" }
}

function load(input: {
  issued: number
  key: string
  cached: UsageLimitsInfo | null | undefined
}): UsageDialogTransition {
  const attempt = input.issued + 1

  const effects: readonly UsageDialogEffect[] = [
    { type: "sync", attempt, key: input.key },
    { type: "timer.start", attempt, timeoutMs: USAGE_LOAD_TIMEOUT_MS },
  ]

  if (input.cached)
    return {
      state: { status: "refreshing", issued: attempt, attempt, key: input.key, info: input.cached },
      effects,
    }

  return { state: { status: "loading", issued: attempt, attempt, key: input.key }, effects }
}

// The cache follows usage events, so the shown limits follow it; only an explicit null means signed out.
function synced(
  state: Exclude<UsageDialogState, { status: "disposed" }>,
  event: Extract<UsageDialogEvent, { type: "cache.synced" }>,
): UsageDialogTransition {
  if (event.key !== state.key || event.limits === undefined) return { state, effects: NONE }
  const limits = event.limits

  if (state.status === "ready" && limits === null)
    return { state: { status: "signed-out", issued: state.issued, key: state.key }, effects: NONE }

  if (limits === null) return { state, effects: NONE }

  if ((state.status === "refreshing" || state.status === "ready") && limits !== state.info)
    return { state: { ...state, info: limits }, effects: NONE }

  if (state.status === "signed-out")
    return { state: { status: "ready", issued: state.issued, key: state.key, info: limits }, effects: NONE }

  return { state, effects: NONE }
}
