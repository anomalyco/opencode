/** Ceiling for `opencode service get remote`. Every command has one, so a hung command never holds the queue. */
export const SERVICE_READ_TIMEOUT_MS = 20_000

/** `opencode service set remote`, which creates the tunnel the first time it turns on. */
export const SERVICE_SET_TIMEOUT_MS = 180_000

/** `opencode service start`, after a change. */
export const SERVICE_START_TIMEOUT_MS = 60_000

/** The display sleep blocker main holds, if any. The OS can drop a held one; `started` reports what it still holds. */
export type BlockerState = { readonly status: "released" } | { readonly status: "held"; readonly id: number }

/** A remote access read, or a change, which sets the setting and then starts the service again. */
export type ServiceRequest =
  | { readonly kind: "get-remote" }
  | { readonly kind: "set-remote"; readonly enabled: boolean }

/** The command that runs; `attempt` fences its result. */
export type ActiveServiceJob = {
  readonly attempt: number
  readonly waiter: number
  readonly job:
    | { readonly kind: "get-remote" }
    | { readonly kind: "set-remote"; readonly enabled: boolean; readonly step: "setting" | "starting" }
}

export type PendingServiceJob = {
  readonly waiter: number
  readonly request: ServiceRequest
}

/**
 * A change restarts the background service, so `opencode service` commands run one at a time: `active` runs and
 * `pending` waits in order. A change's `set` and `start` run as one job, so no read lands between them.
 */
export type PairingMainState =
  | {
      readonly status: "open"
      readonly issued: number
      readonly blocker: BlockerState
      readonly active?: ActiveServiceJob
      readonly pending: readonly PendingServiceJob[]
    }
  | { readonly status: "disposed" }

export type PairingMainEvent =
  | { readonly type: "screen.set"; readonly enabled: boolean; readonly started: boolean }
  | { readonly type: "blocker.started"; readonly id: number }
  | { readonly type: "service.requested"; readonly waiter: number; readonly request: ServiceRequest }
  | { readonly type: "waiter.cancelled"; readonly waiter: number }
  | { readonly type: "service.succeeded"; readonly attempt: number; readonly stdout: string }
  | { readonly type: "service.failed"; readonly attempt: number; readonly message: string }
  | { readonly type: "disposed" }

export type PairingMainEffect =
  | { readonly type: "blocker.start" }
  | { readonly type: "blocker.stop"; readonly id: number }
  | { readonly type: "persist.screen"; readonly enabled: boolean }
  | {
      readonly type: "service.exec"
      readonly attempt: number
      readonly args: readonly string[]
      readonly timeoutMs: number
    }
  | { readonly type: "service.abort"; readonly attempt: number }
  | { readonly type: "waiter.resolve"; readonly waiter: number; readonly value: boolean | undefined }
  | { readonly type: "waiter.reject"; readonly waiter: number; readonly message: string }

export type PairingMainTransition = {
  readonly state: PairingMainState
  readonly effects: readonly PairingMainEffect[]
}

const stopped = "Pairing stopped"

export function createPairingMainState(): PairingMainState {
  return { status: "open", issued: 0, blocker: { status: "released" }, pending: [] }
}

export function transitionPairingMain(state: PairingMainState, event: PairingMainEvent): PairingMainTransition {
  if (state.status === "disposed") {
    if (event.type === "service.requested")
      return { state, effects: [{ type: "waiter.reject", waiter: event.waiter, message: stopped }] }

    if (event.type === "blocker.started") return { state, effects: [{ type: "blocker.stop", id: event.id }] }

    return unchanged(state)
  }

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: [
        ...(state.blocker.status === "held" ? [{ type: "blocker.stop" as const, id: state.blocker.id }] : []),
        ...(state.active
          ? [
              { type: "service.abort" as const, attempt: state.active.attempt },
              { type: "waiter.reject" as const, waiter: state.active.waiter, message: stopped },
            ]
          : []),
        ...state.pending.map((item) => ({ type: "waiter.reject" as const, waiter: item.waiter, message: stopped })),
      ],
    }

  if (event.type === "screen.set") {
    const held = state.blocker.status === "held" && event.started

    if (event.enabled && held) return { state, effects: [{ type: "persist.screen", enabled: true }] }

    // A blocker the OS dropped counts as released, so turning the setting on starts a new one.
    return {
      state: state.blocker.status === "released" ? state : { ...state, blocker: { status: "released" } },
      effects: [
        ...(event.enabled ? [{ type: "blocker.start" as const }] : []),
        ...(!event.enabled && state.blocker.status === "held"
          ? [{ type: "blocker.stop" as const, id: state.blocker.id }]
          : []),
        { type: "persist.screen", enabled: event.enabled },
      ],
    }
  }

  if (event.type === "blocker.started")
    return { state: { ...state, blocker: { status: "held", id: event.id } }, effects: [] }

  if (event.type === "service.requested")
    return advance({ ...state, pending: [...state.pending, { waiter: event.waiter, request: event.request }] }, [])

  if (event.type === "waiter.cancelled") {
    if (state.pending.some((item) => item.waiter === event.waiter))
      return {
        state: { ...state, pending: state.pending.filter((item) => item.waiter !== event.waiter) },
        effects: [{ type: "waiter.reject", waiter: event.waiter, message: "Aborted" }],
      }

    // A change goes on when its window closes; only a read stops.
    if (state.active?.waiter !== event.waiter || state.active.job.kind !== "get-remote") return unchanged(state)

    return advance({ ...state, active: undefined }, [
      { type: "service.abort", attempt: state.active.attempt },
      { type: "waiter.reject", waiter: event.waiter, message: "Aborted" },
    ])
  }

  const active = state.active

  if (active?.attempt !== event.attempt) return unchanged(state)

  if (event.type === "service.failed")
    return advance({ ...state, active: undefined }, [
      { type: "waiter.reject", waiter: active.waiter, message: event.message },
    ])

  if (active.job.kind === "get-remote")
    return advance({ ...state, active: undefined }, [
      { type: "waiter.resolve", waiter: active.waiter, value: event.stdout === "true" },
    ])

  if (active.job.step === "starting")
    return advance({ ...state, active: undefined }, [
      { type: "waiter.resolve", waiter: active.waiter, value: undefined },
    ])
  const attempt = state.issued + 1

  // Changing the setting stops the service; starting it brings it back, with the tunnel when remote access is on.
  return {
    state: {
      ...state,
      issued: attempt,
      active: { attempt, waiter: active.waiter, job: { ...active.job, step: "starting" } },
    },
    effects: [{ type: "service.exec", attempt, args: ["start"], timeoutMs: SERVICE_START_TIMEOUT_MS }],
  }
}

/** The display sleep blocker the state holds, which the OS may have dropped since. */
export function selectBlocker(state: PairingMainState) {
  return state.status === "open" && state.blocker.status === "held" ? state.blocker.id : undefined
}

/** A command that throws before it runs fails its job, so the queue goes on. */
export function pairingMainEffectFailed(effect: PairingMainEffect): PairingMainEvent | undefined {
  if (effect.type === "service.exec")
    return { type: "service.failed", attempt: effect.attempt, message: "Pairing service command failed" }

  return undefined
}

/** Starts the next pending job once none runs. */
function advance(
  state: Extract<PairingMainState, { status: "open" }>,
  effects: readonly PairingMainEffect[],
): PairingMainTransition {
  const head = state.pending[0]

  if (state.active || !head) return { state, effects }
  const attempt = state.issued + 1
  const pending = state.pending.slice(1)

  if (head.request.kind === "get-remote")
    return {
      state: {
        ...state,
        issued: attempt,
        pending,
        active: { attempt, waiter: head.waiter, job: { kind: "get-remote" } },
      },
      effects: [
        ...effects,
        { type: "service.exec", attempt, args: ["get", "remote"], timeoutMs: SERVICE_READ_TIMEOUT_MS },
      ],
    }

  return {
    state: {
      ...state,
      issued: attempt,
      pending,
      active: {
        attempt,
        waiter: head.waiter,
        job: { kind: "set-remote", enabled: head.request.enabled, step: "setting" },
      },
    },
    effects: [
      ...effects,
      {
        type: "service.exec",
        attempt,
        args: ["set", "remote", String(head.request.enabled)],
        timeoutMs: SERVICE_SET_TIMEOUT_MS,
      },
    ],
  }
}

function unchanged(state: PairingMainState): PairingMainTransition {
  return { state, effects: [] }
}
