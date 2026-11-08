// Both ends of an Office worker's call protocol as pure machines: the window's calls waiting for replies, and the
// worker's queue, which runs one call at a time. `worker-rpc.ts` drives them: it posts the messages and runs handlers.

export type RpcRequest = {
  readonly id: number
  readonly method: string
  readonly key?: string
  readonly input: unknown
}

/** Withdraws a call whose caller aborted it. */
export type RpcCancel = { readonly cancel: number }

export type RpcResponse =
  /** `transferred` lists the objects the reply moved, so a reply nobody waits for can close its bitmaps. */
  | { readonly id: number; readonly ok: true; readonly value: unknown; readonly transferred: readonly Transferable[] }
  | { readonly id: number; readonly ok: false; readonly superseded: boolean; readonly message: string }

/** Why the worker stopped answering: the window closed it, or it crashed. */
export type WorkerClientFailure = { readonly kind: "closed" | "crashed"; readonly message: string }

/** Why a call rejects; the driver turns each kind into its error class. */
export type WorkerRejectReason =
  | { readonly kind: "aborted" }
  /** A newer call with the same key replaced it, or its handler failed. */
  | { readonly kind: "superseded" | "error"; readonly message: string }
  | WorkerClientFailure

export type WorkerRpcClientState =
  /** The worker answers; `pending` holds the ids of the calls waiting for a reply. */
  | { readonly status: "live"; readonly pending: ReadonlySet<number> }
  /** The worker is gone: every call, pending or later, rejects with `failure`. */
  | { readonly status: "closed"; readonly failure: WorkerClientFailure }

export type WorkerRpcClientEvent =
  /** `aborted` when the caller's signal aborted before the call. */
  | {
      readonly type: "call.requested"
      readonly request: RpcRequest
      readonly transfer: readonly Transferable[]
      readonly aborted: boolean
    }
  /** Posting the request threw, as it does for a detached buffer. */
  | { readonly type: "call.post-failed"; readonly id: number; readonly message: string }
  | { readonly type: "call.aborted"; readonly id: number }
  | { readonly type: "reply.received"; readonly response: RpcResponse }
  /** The worker raised `error` or `messageerror`. */
  | { readonly type: "worker.crashed"; readonly message: string }
  | { readonly type: "closed" }

export type WorkerRpcClientEffect =
  | { readonly type: "post-request"; readonly request: RpcRequest; readonly transfer: readonly Transferable[] }
  | { readonly type: "post-cancel"; readonly id: number }
  | { readonly type: "resolve-call"; readonly id: number; readonly value: unknown }
  /** Rejects the calls and detaches their abort listeners. */
  | { readonly type: "reject-calls"; readonly ids: readonly number[]; readonly reason: WorkerRejectReason }
  | { readonly type: "close-bitmaps"; readonly transferred: readonly Transferable[] }
  | { readonly type: "terminate-worker" }
  /** Tells the viewer its worker crashed. */
  | { readonly type: "notify-crash" }

export type WorkerRpcClientTransition = {
  readonly state: WorkerRpcClientState
  readonly effects: readonly WorkerRpcClientEffect[]
}

export type WorkerRpcServerState =
  /** No call runs or waits. `attempt` is the last one claimed, so a timer of an earlier phase is stale. */
  | { readonly status: "idle"; readonly attempt: number }
  /**
   * Calls wait one macrotask (`attempt`) before the head runs, so calls that arrive meanwhile can replace or cancel
   * it. No handler runs.
   */
  | { readonly status: "yielding"; readonly attempt: number; readonly queue: readonly RpcRequest[] }
  /** `request`'s handler runs under `attempt`; `cancelled` once its caller aborted it. */
  | {
      readonly status: "running"
      readonly attempt: number
      readonly request: RpcRequest
      readonly cancelled: boolean
      readonly queue: readonly RpcRequest[]
    }

export type WorkerRpcServerEvent =
  | { readonly type: "request.received"; readonly request: RpcRequest }
  | { readonly type: "cancel.received"; readonly id: number }
  | { readonly type: "turn.ready"; readonly attempt: number }
  | {
      readonly type: "handler.succeeded"
      readonly attempt: number
      readonly value: unknown
      readonly transfer: readonly Transferable[]
    }
  /** The handler threw or rejected, or no handler has the method. */
  | { readonly type: "handler.failed"; readonly attempt: number; readonly message: string }
  /** Posting a successful reply threw, as it does for a value that cannot be cloned. */
  | {
      readonly type: "reply.failed"
      readonly id: number
      readonly message: string
      readonly transferred: readonly Transferable[]
    }

export type WorkerRpcServerEffect =
  | { readonly type: "schedule-turn"; readonly attempt: number }
  | { readonly type: "run-handler"; readonly attempt: number; readonly request: RpcRequest }
  | { readonly type: "abort-handler"; readonly attempt: number }
  | { readonly type: "reply"; readonly response: RpcResponse; readonly transfer: readonly Transferable[] }
  | { readonly type: "close-bitmaps"; readonly transferred: readonly Transferable[] }

export type WorkerRpcServerTransition = {
  readonly state: WorkerRpcServerState
  readonly effects: readonly WorkerRpcServerEffect[]
}

const NONE: readonly never[] = []

const ABORTED: WorkerRejectReason = { kind: "aborted" }

const CLOSED: WorkerClientFailure = { kind: "closed", message: "The Office engine was closed" }

export function transitionWorkerRpcClient(
  state: WorkerRpcClientState,
  event: WorkerRpcClientEvent,
): WorkerRpcClientTransition {
  if (event.type === "call.requested") {
    const id = event.request.id

    if (state.status === "closed")
      return { state, effects: [{ type: "reject-calls", ids: [id], reason: state.failure }] }

    if (event.aborted) return { state, effects: [{ type: "reject-calls", ids: [id], reason: ABORTED }] }

    return {
      state: { status: "live", pending: new Set(state.pending).add(id) },
      effects: [{ type: "post-request", request: event.request, transfer: event.transfer }],
    }
  }

  if (event.type === "reply.received") {
    const response = event.response

    // A reply that crossed its call's cancel, or came after the close: its bitmaps would hold memory until collected.
    if (state.status === "closed" || !state.pending.has(response.id))
      return {
        state,
        effects:
          response.ok && response.transferred.length > 0
            ? [{ type: "close-bitmaps", transferred: response.transferred }]
            : NONE,
      }

    return {
      state: settle(state.pending, response.id),
      effects: [
        response.ok
          ? { type: "resolve-call", id: response.id, value: response.value }
          : {
              type: "reject-calls",
              ids: [response.id],
              reason: { kind: response.superseded ? "superseded" : "error", message: response.message },
            },
      ],
    }
  }

  // A dead worker gets no cancel, and its calls already rejected.
  if (state.status === "closed") return { state, effects: NONE }

  if (event.type === "call.aborted") {
    if (!state.pending.has(event.id)) return { state, effects: NONE }

    return {
      state: settle(state.pending, event.id),
      effects: [
        { type: "reject-calls", ids: [event.id], reason: ABORTED },
        { type: "post-cancel", id: event.id },
      ],
    }
  }

  if (event.type === "call.post-failed") {
    if (!state.pending.has(event.id)) return { state, effects: NONE }

    return {
      state: settle(state.pending, event.id),
      effects: [{ type: "reject-calls", ids: [event.id], reason: { kind: "error", message: event.message } }],
    }
  }

  const failure: WorkerClientFailure =
    event.type === "worker.crashed" ? { kind: "crashed", message: event.message } : CLOSED

  return {
    state: { status: "closed", failure },
    effects: [
      { type: "terminate-worker" },
      ...(state.pending.size > 0 ? [{ type: "reject-calls" as const, ids: [...state.pending], reason: failure }] : []),
      ...(event.type === "worker.crashed" ? [{ type: "notify-crash" as const }] : []),
    ],
  }
}

export function transitionWorkerRpcServer(
  state: WorkerRpcServerState,
  event: WorkerRpcServerEvent,
): WorkerRpcServerTransition {
  if (event.type === "request.received") {
    if (state.status === "idle") {
      const attempt = state.attempt + 1

      return {
        state: { status: "yielding", attempt, queue: [event.request] },
        effects: [{ type: "schedule-turn", attempt }],
      }
    }

    // A newer call with the same key replaces a queued one, never the one that runs.
    const key = event.request.key
    const replaced = key === undefined ? undefined : state.queue.find((request) => request.key === key)

    return {
      state: { ...state, queue: [...state.queue.filter((request) => request !== replaced), event.request] },
      effects: replaced
        ? [
            {
              type: "reply",
              response: { id: replaced.id, ok: false, superseded: true, message: "Replaced by a newer call" },
              transfer: NONE,
            },
          ]
        : NONE,
    }
  }

  // The caller already settled a cancelled call, so it gets no reply.
  if (event.type === "cancel.received") {
    if (state.status === "running" && state.request.id === event.id) {
      if (state.cancelled) return { state, effects: NONE }

      return { state: { ...state, cancelled: true }, effects: [{ type: "abort-handler", attempt: state.attempt }] }
    }

    if (state.status === "idle" || !state.queue.some((request) => request.id === event.id))
      return { state, effects: NONE }

    const queue = state.queue.filter((request) => request.id !== event.id)

    if (state.status === "yielding" && queue.length === 0)
      return { state: { status: "idle", attempt: state.attempt }, effects: NONE }

    return { state: { ...state, queue }, effects: NONE }
  }

  if (event.type === "turn.ready") {
    if (state.status !== "yielding" || event.attempt !== state.attempt) return { state, effects: NONE }

    const [request, ...queue] = state.queue

    if (!request) return { state: { status: "idle", attempt: state.attempt }, effects: NONE }

    const attempt = state.attempt + 1

    return {
      state: { status: "running", attempt, request, cancelled: false, queue },
      effects: [{ type: "run-handler", attempt, request }],
    }
  }

  // The reply could not be posted, so its bitmaps stay here; the caller still gets an answer.
  if (event.type === "reply.failed")
    return {
      state,
      effects: [
        ...closeBitmaps(event.transferred),
        {
          type: "reply",
          response: { id: event.id, ok: false, superseded: false, message: event.message },
          transfer: NONE,
        },
      ],
    }

  const transferred = event.type === "handler.succeeded" ? event.transfer : NONE

  if (state.status !== "running" || event.attempt !== state.attempt)
    return { state, effects: closeBitmaps(transferred) }

  // The caller already settled a call it aborted, so nothing would take the reply or its bitmaps.
  if (state.cancelled) return next(state, closeBitmaps(transferred))

  if (event.type === "handler.failed")
    return next(state, [
      {
        type: "reply",
        response: { id: state.request.id, ok: false, superseded: false, message: event.message },
        transfer: NONE,
      },
    ])

  return next(state, [
    {
      type: "reply",
      response: { id: state.request.id, ok: true, value: event.value, transferred },
      transfer: transferred,
    },
  ])
}

/** The client's state without one call that has settled. */
function settle(pending: ReadonlySet<number>, id: number): WorkerRpcClientState {
  const next = new Set(pending)

  next.delete(id)

  return { status: "live", pending: next }
}

/** Leaves the finished call behind: the queue yields once before its head runs, or the worker goes idle. */
function next(
  state: Extract<WorkerRpcServerState, { status: "running" }>,
  effects: readonly WorkerRpcServerEffect[],
): WorkerRpcServerTransition {
  if (state.queue.length === 0) return { state: { status: "idle", attempt: state.attempt }, effects }

  const attempt = state.attempt + 1

  return {
    state: { status: "yielding", attempt, queue: state.queue },
    effects: [...effects, { type: "schedule-turn", attempt }],
  }
}

function closeBitmaps(transferred: readonly Transferable[]): readonly WorkerRpcServerEffect[] {
  return transferred.length > 0 ? [{ type: "close-bitmaps", transferred }] : NONE
}
