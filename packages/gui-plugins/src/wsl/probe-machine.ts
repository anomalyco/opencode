import type { AddServerProbePlan } from "./model"

/** Ceiling for one probe call, above main's own 20 s `wsl.exe` timeout, in case the bridge hangs. */
export const WSL_PROBE_TIMEOUT_MS = 60_000

/** What the add dialog plans from main's state and its own. */
export type WslProbeInput = {
  /** The probe the dialog needs next, if any. */
  readonly plan: AddServerProbePlan | undefined
  /** Main runs a job the dialog waits for, or the dialog adds a server. */
  readonly busy: boolean
  /** WSL's main side answers. */
  readonly available: boolean
}

/**
 * One probe runs at a time. A reply can arrive before the state that carries its result, so the key that just
 * succeeded runs again only after the plan has moved past it. A key that failed runs again only after the user asks
 * to check again or main comes back.
 */
export type WslProbeState =
  | {
      readonly status: "idle"
      readonly issued: number
      /** The key whose probe last succeeded; held until a state without a running job plans another key. */
      readonly completed?: string
      readonly failed: ReadonlySet<string>
    }
  | {
      readonly status: "running"
      readonly issued: number
      readonly attempt: number
      readonly command: AddServerProbePlan
      readonly failed: ReadonlySet<string>
    }
  | { readonly status: "disposed" }

export type WslProbeEvent =
  | ({ readonly type: "synced" } & WslProbeInput)
  | { readonly type: "reset" }
  | ({ readonly type: "probe.succeeded"; readonly attempt: number } & WslProbeInput)
  | ({ readonly type: "probe.failed"; readonly attempt: number; readonly cause: unknown } & WslProbeInput)
  | { readonly type: "disposed" }

export type WslProbeEffect =
  | {
      readonly type: "probe.run"
      readonly attempt: number
      readonly command: AddServerProbePlan
      readonly timeoutMs: number
    }
  | { readonly type: "probe.abort"; readonly attempt: number }
  | { readonly type: "probe.error"; readonly cause: unknown }

export type WslProbeTransition = {
  readonly state: WslProbeState
  readonly effects: readonly WslProbeEffect[]
}

export function createWslProbeState(): WslProbeState {
  return { status: "idle", issued: 0, failed: new Set() }
}

export function transitionWslProbes(state: WslProbeState, event: WslProbeEvent): WslProbeTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: state.status === "running" ? [{ type: "probe.abort", attempt: state.attempt }] : [],
    }

  // Only the user asking to check again clears failures; the next state plans again.
  if (event.type === "reset")
    return state.failed.size === 0 ? unchanged(state) : { state: { ...state, failed: new Set() }, effects: [] }

  if (state.status === "idle") {
    if (event.type !== "synced") return unchanged(state)

    return schedule(state, state.issued, state.completed, state.failed, event)
  }

  if (event.type === "synced") {
    if (event.available) return unchanged(state)

    return {
      state: { status: "idle", issued: state.issued, failed: new Set() },
      effects: [{ type: "probe.abort", attempt: state.attempt }],
    }
  }

  if (event.attempt !== state.attempt) return unchanged(state)
  const abort: WslProbeEffect = { type: "probe.abort", attempt: event.attempt }

  if (event.type === "probe.succeeded") {
    const next = schedule(undefined, state.issued, state.command.key, state.failed, event)

    return { state: next.state, effects: [abort, ...next.effects] }
  }

  const next = schedule(undefined, state.issued, undefined, new Set([...state.failed, state.command.key]), event)

  return { state: next.state, effects: [abort, { type: "probe.error", cause: event.cause }, ...next.effects] }
}

/** Whether a probe of distros the dialog can add runs; their rows show "Checking". */
export function selectWslProbingAddable(state: WslProbeState) {
  return state.status === "running" && state.command.kind === "addable"
}

function schedule(
  previous: Extract<WslProbeState, { status: "idle" }> | undefined,
  issued: number,
  completed: string | undefined,
  failed: ReadonlySet<string>,
  input: WslProbeInput,
): WslProbeTransition {
  if (!input.available) {
    if (previous && previous.completed === undefined && previous.failed.size === 0) return unchanged(previous)

    return { state: { status: "idle", issued, failed: new Set() }, effects: [] }
  }

  const held = completed !== undefined && (input.busy || input.plan?.key === completed) ? completed : undefined
  const plan = input.plan

  if (!plan || plan.key === held || failed.has(plan.key)) {
    if (previous && previous.completed === held && previous.failed === failed) return unchanged(previous)

    return { state: { status: "idle", issued, completed: held, failed }, effects: [] }
  }

  const attempt = issued + 1

  return {
    state: { status: "running", issued: attempt, attempt, command: plan, failed },
    effects: [{ type: "probe.run", attempt, command: plan, timeoutMs: WSL_PROBE_TIMEOUT_MS }],
  }
}

function unchanged(state: WslProbeState): WslProbeTransition {
  return { state, effects: [] }
}
