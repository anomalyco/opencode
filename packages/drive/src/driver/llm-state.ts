import * as Data from "effect/Data"
import type * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import type { Backend } from "../client/protocol.js"
import type * as Llm from "../llm/index.js"
import type { BackendConnection } from "../simulation/connector.js"
import {
  controllerError,
  LlmControllerError,
  LlmModeError,
  LlmSettlementError,
} from "./llm-errors.js"
import type { Response } from "./llm-responder.js"

/**
 * Pure state and transitions for the LLM controller. The shell in
 * `llm-controller.ts` owns all concurrency: it holds the lock, creates
 * completions, runs jobs, and resolves deferreds. Completions appear here
 * only as opaque tokens tracked for membership — nothing in this module
 * awaits or completes them.
 */

/** Opaque token for one in-flight job, resolved by the shell. */
export type Completion = Deferred.Deferred<void, LlmControllerError>

export type ServeHandler = (
  request: Backend.OpenedExchange,
  index: number,
) => Response

export type TitleHandler = (
  request: Backend.OpenedExchange,
  index: number,
) => Effect.Effect<string, LlmControllerError>

export interface QueuedResponse {
  readonly output: ReadonlyArray<Llm.Output>
  readonly completed?: Completion
}

export interface AttachedRequest {
  readonly request: Backend.OpenedExchange
  readonly backend: BackendConnection
}

/** How the controller answers normal (non-title) requests. */
export type Mode = Data.TaggedEnum<{
  Unset: {}
  Queue: {}
  Serve: { readonly handler: ServeHandler }
}>
export const Mode = Data.taggedEnum<Mode>()

export interface State {
  readonly mode: Mode
  readonly titleHandler: TitleHandler
  readonly titleConfigured: boolean
  readonly requests: ReadonlyArray<AttachedRequest>
  readonly responses: ReadonlyArray<QueuedResponse>
  readonly activeNormal: ReadonlyArray<Completion>
  readonly activeTitles: ReadonlyArray<Completion>
  readonly sendCompletions: ReadonlyArray<Completion>
  readonly requestIndex: number
  readonly titleIndex: number
  readonly failure: LlmControllerError | undefined
  readonly settling: boolean
  readonly settled: boolean
}

export const initial: State = {
  mode: Mode.Unset(),
  titleHandler: () => Effect.succeed("OpenCode Drive"),
  titleConfigured: false,
  requests: [],
  responses: [],
  activeNormal: [],
  activeTitles: [],
  sendCompletions: [],
  requestIndex: 0,
  titleIndex: 0,
  failure: undefined,
  settling: false,
  settled: false,
}

// ─── Guards ──────────────────────────────────────────────────────────────────

/** Why a control call (queue/send/serve/title) was rejected. */
export type RejectionError = LlmModeError | LlmControllerError

const rejectWhileSettling = (state: State, operation: string) =>
  state.settling || state.settled
    ? controllerError(operation, "LLM controller is settling")
    : undefined

/** Why a queue/send call must be rejected, or undefined to proceed. */
export const rejectEnqueue = (
  state: State,
  operation: "queue" | "send",
): RejectionError | undefined => {
  if (state.failure !== undefined) return state.failure
  if (Mode.$is("Serve")(state.mode))
    return new LlmModeError({
      operation,
      message: `llm.${operation} cannot be used after llm.serve`,
    })
  return rejectWhileSettling(state, operation)
}

/** Why a serve call must be rejected, or undefined to proceed. */
export const rejectServe = (state: State): RejectionError | undefined => {
  if (state.failure !== undefined) return state.failure
  if (!Mode.$is("Unset")(state.mode))
    return new LlmModeError({
      operation: "serve",
      message: "llm.serve must be the only LLM response mode",
    })
  return rejectWhileSettling(state, "serve")
}

/** Why a title call must be rejected, or undefined to proceed. */
export const rejectTitle = (state: State): RejectionError | undefined => {
  if (state.failure !== undefined) return state.failure
  if (state.titleConfigured)
    return new LlmModeError({
      operation: "title",
      message: "llm.title may only be configured once",
    })
  return rejectWhileSettling(state, "title")
}

// ─── Transitions ─────────────────────────────────────────────────────────────

export const enqueue = (state: State, response: QueuedResponse): State => ({
  ...state,
  mode: Mode.Queue(),
  responses: [...state.responses, response],
  sendCompletions:
    response.completed === undefined
      ? state.sendCompletions
      : [...state.sendCompletions, response.completed],
})

export const serve = (state: State, handler: ServeHandler): State => ({
  ...state,
  mode: Mode.Serve({ handler }),
})

export const configureTitle = (state: State, handler: TitleHandler): State => ({
  ...state,
  titleConfigured: true,
  titleHandler: handler,
})

export const pushRequest = (state: State, request: AttachedRequest): State => ({
  ...state,
  requests: [...state.requests, request],
})

/** Withdraws an interrupted send before it was matched to a request. */
export const abandonSend = (state: State, completed: Completion): State => ({
  ...state,
  responses: state.responses.filter(
    (response) => response.completed !== completed,
  ),
  sendCompletions: state.sendCompletions.filter(
    (candidate) => candidate !== completed,
  ),
})

/** Records the first failure; later failures preserve the original. */
export const recordFailure = (
  state: State,
  error: LlmControllerError,
): readonly [
  State,
  { readonly failure: LlmControllerError; readonly isFirst: boolean },
] => {
  const failure = state.failure ?? error
  const isFirst = state.failure === undefined
  return [isFirst ? { ...state, failure } : state, { failure, isFirst }]
}

// ─── Normal jobs ─────────────────────────────────────────────────────────────

/** Where a normal job's response comes from. */
export type NormalSource = Data.TaggedEnum<{
  Queued: { readonly response: QueuedResponse }
  Served: { readonly handler: ServeHandler }
}>
export const NormalSource = Data.taggedEnum<NormalSource>()

/** A runnable normal job selected by {@link nextNormal}. */
export interface NormalStart {
  readonly request: AttachedRequest
  readonly index: number
  readonly source: NormalSource
}

/** Selects the next runnable normal job, or undefined when nothing can run. */
export const nextNormal = (state: State): NormalStart | undefined => {
  if (state.failure !== undefined) return undefined
  const request = state.requests[0]
  if (request === undefined) return undefined
  if (Mode.$is("Serve")(state.mode))
    return {
      request,
      index: state.requestIndex,
      source: NormalSource.Served({ handler: state.mode.handler }),
    }
  const response = state.responses[0]
  if (response === undefined) return undefined
  return {
    request,
    index: state.requestIndex,
    source: NormalSource.Queued({ response }),
  }
}

/** Commits a selected job: consumes its inputs and tracks its completion. */
export const startNormal = (
  state: State,
  start: NormalStart,
  completion: Completion,
): State => ({
  ...state,
  requests: state.requests.slice(1),
  responses: NormalSource.$is("Queued")(start.source)
    ? state.responses.slice(1)
    : state.responses,
  activeNormal: [...state.activeNormal, completion],
  requestIndex: state.requestIndex + 1,
})

/** Untracks a finished normal job and its optional send completion. */
export const finishNormal = (
  state: State,
  completion: Completion,
  sendCompletion: Completion | undefined,
): State => ({
  ...state,
  activeNormal: state.activeNormal.filter((active) => active !== completion),
  sendCompletions:
    sendCompletion === undefined
      ? state.sendCompletions
      : state.sendCompletions.filter((active) => active !== sendCompletion),
})

// ─── Title jobs ──────────────────────────────────────────────────────────────

/** A title job selected by {@link startTitle}. */
export interface TitleStart {
  readonly handler: TitleHandler
  readonly index: number
  /** Normal jobs the title must wait for before responding. */
  readonly awaiting: ReadonlyArray<Completion>
}

/** Tracks a title job; titles run outside normal request sequencing. */
export const startTitle = (
  state: State,
  completion: Completion,
): readonly [State, TitleStart] => [
  {
    ...state,
    activeTitles: [...state.activeTitles, completion],
    titleIndex: state.titleIndex + 1,
  },
  {
    handler: state.titleHandler,
    index: state.titleIndex,
    awaiting: state.activeNormal,
  },
]

export const finishTitle = (state: State, completion: Completion): State => ({
  ...state,
  activeTitles: state.activeTitles.filter((active) => active !== completion),
})

// ─── Settlement ──────────────────────────────────────────────────────────────

export type Settlement = Data.TaggedEnum<{
  /** All work has drained; the controller is settled. */
  Done: {}
  /** Queued or active work remains; wait for the next change. */
  Wait: {}
  Fail: { readonly error: LlmControllerError | LlmSettlementError }
}>
export const Settlement = Data.taggedEnum<Settlement>()

/** Decides whether settlement is complete, failed, or must keep waiting. */
export const inspectSettlement = (state: State): Settlement => {
  if (state.failure !== undefined)
    return Settlement.Fail({ error: state.failure })
  if (
    Mode.$is("Queue")(state.mode) &&
    state.requests.length > 0 &&
    state.responses.length === 0
  )
    return Settlement.Fail({
      error: new LlmSettlementError({
        unusedResponses: 0,
        unexpectedRequests: state.requests.length,
        message: `received ${state.requests.length} unexpected LLM request(s)`,
      }),
    })
  if (
    state.responses.length > 0 ||
    state.activeNormal.length > 0 ||
    state.activeTitles.length > 0
  )
    return Settlement.Wait()
  return Settlement.Done()
}

/** The error reported when settlement times out. */
export const settlementTimeoutError = (state: State): LlmSettlementError =>
  new LlmSettlementError({
    unusedResponses: state.responses.length,
    unexpectedRequests: state.requests.length,
    message:
      state.responses.length > 0
        ? `timed out with ${state.responses.length} unused LLM response(s)`
        : "timed out waiting for active LLM responses",
  })

export const beginSettling = (state: State): State =>
  state.settling ? state : { ...state, settling: true }

export const markSettled = (state: State): State => ({
  ...state,
  settled: true,
})

/** Terminal shutdown: pending work is discarded and future calls fail. */
export const close = (state: State, failure: LlmControllerError): State => ({
  ...state,
  requests: [],
  responses: [],
  failure,
  settling: true,
  settled: true,
})
