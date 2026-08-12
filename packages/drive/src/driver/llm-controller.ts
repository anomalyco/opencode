import type * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberSet from "effect/FiberSet"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as Llm from "../llm/index.js"
import { isTitleRequest } from "../llm/internal.js"
import type { BackendConnection } from "../simulation/connector.js"
import {
  causeError,
  controllerError,
  LlmControllerError,
  LlmSettlementError,
} from "./llm-errors.js"
import * as LlmResponder from "./llm-responder.js"
import * as LlmState from "./llm-state.js"

/**
 * The concurrency shell of the LLM controller. Decision logic lives in the
 * pure `llm-state.ts` module; wire streaming lives in `llm-responder.ts`.
 * This module owns the lock, the state ref, job fibers, and deferreds.
 */

export {
  LlmControllerError,
  LlmModeError,
  LlmSettlementError,
} from "./llm-errors.js"
export type { Response } from "./llm-responder.js"
export type { ServeHandler, TitleHandler } from "./llm-state.js"

export interface Options {
  /** Per-backend-RPC timeout in milliseconds. Defaults to 30,000. */
  readonly requestTimeout?: number
  /** Time allowed for queued and active responses to settle. Defaults to 30,000. */
  readonly settlementTimeout?: number
}

export interface Controller {
  /** Attaches one backend generation while preserving response state. */
  readonly attach: (
    backend: BackendConnection,
  ) => Effect.Effect<Attachment, LlmControllerError>
  readonly queue: (
    ...output: ReadonlyArray<Llm.Output>
  ) => Effect.Effect<void, LlmState.RejectionError>
  readonly send: (
    ...output: ReadonlyArray<Llm.Output>
  ) => Effect.Effect<void, LlmState.RejectionError>
  readonly serve: (
    handler: LlmState.ServeHandler,
  ) => Effect.Effect<void, LlmState.RejectionError>
  readonly title: (
    handler: LlmState.TitleHandler,
  ) => Effect.Effect<void, LlmState.RejectionError>
  readonly settle: () => Effect.Effect<
    void,
    LlmControllerError | LlmSettlementError
  >
  /** Interrupts request routing and response workers. Used by the driver coordinator. */
  readonly shutdown: () => Effect.Effect<void>
  /** Fails when request routing or the backend connection fails. */
  readonly failure: Effect.Effect<never, LlmControllerError>
}

export interface Attachment {
  readonly detach: () => Effect.Effect<void>
}

/** A committed normal job: its selection plus the shell-owned completion. */
interface NormalJob extends LlmState.NormalStart {
  readonly completion: LlmState.Completion
}

const NonNegativeMilliseconds = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
)
const decodeOutputs = Schema.decodeUnknownEffect(Schema.Array(Llm.Output))

export const make = Effect.fn("LlmController.make")(function* (
  backendOrOptions?: BackendConnection | Options,
  explicitOptions?: Options,
) {
  const initialBackend = isBackendConnection(backendOrOptions)
    ? backendOrOptions
    : undefined
  const options = isBackendConnection(backendOrOptions)
    ? explicitOptions
    : backendOrOptions
  const requestTimeout = NonNegativeMilliseconds.make(
    options?.requestTimeout ?? 30_000,
  )
  const settlementTimeout = NonNegativeMilliseconds.make(
    options?.settlementTimeout ?? 30_000,
  )
  const responder = LlmResponder.make({ requestTimeout })

  const state = yield* Ref.make(LlmState.initial)
  const lock = yield* Semaphore.make(1)
  const changes = yield* Queue.sliding<void>(1)
  const failureSignal = yield* Deferred.make<never, LlmControllerError>()
  const tasks = yield* FiberSet.make<void, never>()
  const parentScope = yield* Scope.Scope
  const attached = yield* Ref.make<
    { readonly backend: BackendConnection; readonly scope: Scope.Scope }
    | undefined
  >(undefined)

  yield* Effect.addFinalizer(() => Queue.shutdown(changes))

  const notify = Queue.offer(changes, undefined).pipe(Effect.asVoid)

  const respondTo = (
    request: LlmState.AttachedRequest,
    output: LlmResponder.Response,
  ) => responder.respond(request.backend, request.request.id, output)

  const failCompletions = (
    completions: ReadonlyArray<LlmState.Completion>,
    error: LlmControllerError,
  ) =>
    Effect.forEach(
      completions,
      (completion) => Deferred.fail(completion, error),
      { discard: true },
    )

  /** Must run while holding the lock. */
  const recordFailureLocked = Effect.fn("LlmController.recordFailureLocked")(
    function* (error: LlmControllerError) {
      const current = yield* Ref.get(state)
      const [next, { failure, isFirst }] = LlmState.recordFailure(
        current,
        error,
      )
      yield* Ref.set(state, next)
      if (isFirst) yield* Deferred.fail(failureSignal, failure)
      yield* failCompletions(current.sendCompletions, failure)
      yield* notify
      return failure
    },
  )

  const completeNormal = Effect.fn("LlmController.completeNormal")(function* (
    job: NormalJob,
    error?: LlmControllerError,
  ) {
    const sendCompletion = LlmState.NormalSource.$is("Queued")(job.source)
      ? job.source.response.completed
      : undefined
    yield* lock.withPermit(
      Effect.gen(function* () {
        yield* Ref.update(state, (current) =>
          LlmState.finishNormal(current, job.completion, sendCompletion),
        )
        if (error === undefined) {
          yield* Deferred.succeed(job.completion, undefined)
          if (sendCompletion !== undefined)
            yield* Deferred.succeed(sendCompletion, undefined)
        } else {
          yield* Deferred.fail(job.completion, error)
          if (sendCompletion !== undefined)
            yield* Deferred.fail(sendCompletion, error)
          yield* recordFailureLocked(error)
        }
        yield* notify
      }),
    )
  })

  const runNormal = (job: NormalJob): Effect.Effect<void> => {
    const output = LlmState.NormalSource.$match(job.source, {
      Queued: ({ response }) =>
        respondTo(job.request, Stream.fromIterable(response.output)),
      Served: ({ handler }) =>
        Effect.suspend(() =>
          respondTo(job.request, handler(job.request.request, job.index)),
        ),
    })
    return Effect.matchCauseEffect(output, {
      onFailure: (cause) =>
        completeNormal(job, causeError("respond", cause, job.request.request.id)),
      onSuccess: () => completeNormal(job),
    })
  }

  /** Starts every runnable normal job. Must run while holding the lock. */
  const drainLocked = Effect.fn("LlmController.drainLocked")(function* () {
    while (true) {
      const current = yield* Ref.get(state)
      const start = LlmState.nextNormal(current)
      if (start === undefined) return
      const completion = yield* Deferred.make<void, LlmControllerError>()
      yield* Ref.set(state, LlmState.startNormal(current, start, completion))
      yield* FiberSet.run(tasks, runNormal({ ...start, completion }))
      yield* notify
    }
  })

  const completeTitle = Effect.fn("LlmController.completeTitle")(function* (
    completion: LlmState.Completion,
    error?: LlmControllerError,
  ) {
    yield* lock.withPermit(
      Effect.gen(function* () {
        yield* Ref.update(state, (current) =>
          LlmState.finishTitle(current, completion),
        )
        if (error === undefined) yield* Deferred.succeed(completion, undefined)
        else {
          yield* Deferred.fail(completion, error)
          yield* recordFailureLocked(error)
        }
        yield* notify
      }),
    )
  })

  /** Titles respond after in-flight normal jobs, outside request sequencing. */
  const startTitleLocked = Effect.fn("LlmController.startTitleLocked")(
    function* (request: LlmState.AttachedRequest) {
      const completion = yield* Deferred.make<void, LlmControllerError>()
      const current = yield* Ref.get(state)
      const [next, title] = LlmState.startTitle(current, completion)
      yield* Ref.set(state, next)
      const respond = Effect.gen(function* () {
        yield* Effect.forEach(title.awaiting, Deferred.await, { discard: true })
        const text = yield* Effect.suspend(() =>
          title.handler(request.request, title.index),
        )
        yield* respondTo(request, Stream.make(Llm.text(text)))
      })
      yield* FiberSet.run(
        tasks,
        Effect.matchCauseEffect(respond, {
          onFailure: (cause) =>
            completeTitle(
              completion,
              causeError("title", cause, request.request.id),
            ),
          onSuccess: () => completeTitle(completion),
        }),
      )
      yield* notify
    },
  )

  const routeRequest = (request: LlmState.AttachedRequest) =>
    lock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        if (current.failure !== undefined || current.settled) return
        if (isTitleRequest(request.request.body)) {
          yield* startTitleLocked(request)
          return
        }
        yield* Ref.set(state, LlmState.pushRequest(current, request))
        yield* drainLocked()
        yield* notify
      }),
    )

  const recordRouterFailure = (cause: Cause.Cause<Schema.SchemaError>) =>
    lock.withPermit(
      recordFailureLocked(causeError("route requests", cause)),
    ).pipe(Effect.asVoid)

  const attach = Effect.fn("LlmController.attach")(function* (
    backend: BackendConnection,
  ) {
    const scope = yield* lock.withPermit(
      Effect.gen(function* () {
        if ((yield* Ref.get(attached)) !== undefined)
          return yield* Effect.fail(
            controllerError("attach", "LLM backend is already attached"),
          )
        const scope = yield* Scope.fork(parentScope)
        yield* Ref.set(attached, { backend, scope })
        return scope
      }),
    )
    yield* backend.requests.pipe(
      Stream.runForEach((request) => routeRequest({ request, backend })),
      Effect.matchCauseEffect({
        onFailure: recordRouterFailure,
        onSuccess: () => Effect.void,
      }),
      Effect.forkIn(scope),
    )
    yield* backend.closed.pipe(
      Effect.andThen(
        lock.withPermit(
          Effect.gen(function* () {
            const active = yield* Ref.get(attached)
            if (active?.backend !== backend) return
            const current = yield* Ref.get(state)
            if (current.settled) return
            yield* recordFailureLocked(
              controllerError("backend", "backend connection closed"),
            )
          }),
        ),
      ),
      Effect.forkIn(scope),
    )
    const detach = Effect.fn("LlmController.detach")(function* () {
      const shouldClose = yield* lock.withPermit(
        Effect.gen(function* () {
          const active = yield* Ref.get(attached)
          if (active?.backend !== backend) return false
          yield* Ref.set(attached, undefined)
          return true
        }),
      )
      if (shouldClose) yield* Scope.close(scope, Exit.void)
    })
    return { detach } satisfies Attachment
  })

  const enqueue = Effect.fn("LlmController.enqueue")(function* (
    operation: "queue" | "send",
    output: ReadonlyArray<Llm.Output>,
    completed?: LlmState.Completion,
  ) {
    const decoded = yield* decodeOutputs(output).pipe(
      Effect.mapError((cause) => controllerError(operation, cause)),
    )
    yield* lock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        const rejection = LlmState.rejectEnqueue(current, operation)
        if (rejection !== undefined) return yield* Effect.fail(rejection)
        yield* Ref.set(
          state,
          LlmState.enqueue(current, { output: decoded, completed }),
        )
        yield* drainLocked()
        yield* notify
        return undefined
      }),
    )
  })

  const queue = Effect.fn("LlmController.queue")(
    (...output: ReadonlyArray<Llm.Output>) => enqueue("queue", output),
  )

  const send = Effect.fn("LlmController.send")(function* (
    ...output: ReadonlyArray<Llm.Output>
  ) {
    const completed = yield* Deferred.make<void, LlmControllerError>()
    yield* enqueue("send", output, completed)
    yield* Deferred.await(completed).pipe(
      Effect.onInterrupt(() =>
        lock.withPermit(
          Effect.gen(function* () {
            yield* Ref.update(state, (current) =>
              LlmState.abandonSend(current, completed),
            )
            yield* notify
          }),
        ),
      ),
    )
  })

  const serve = Effect.fn("LlmController.serve")(
    (handler: LlmState.ServeHandler) =>
      lock.withPermit(
        Effect.gen(function* () {
          const current = yield* Ref.get(state)
          const rejection = LlmState.rejectServe(current)
          if (rejection !== undefined) return yield* Effect.fail(rejection)
          yield* Ref.set(state, LlmState.serve(current, handler))
          yield* drainLocked()
          yield* notify
          return undefined
        }),
      ),
  )

  const title = Effect.fn("LlmController.title")(
    (handler: LlmState.TitleHandler) =>
      lock.withPermit(
        Effect.gen(function* () {
          const current = yield* Ref.get(state)
          const rejection = LlmState.rejectTitle(current)
          if (rejection !== undefined) return yield* Effect.fail(rejection)
          yield* Ref.set(state, LlmState.configureTitle(current, handler))
          yield* notify
          return undefined
        }),
      ),
  )

  const inspectSettlement = lock.withPermit(
    Effect.gen(function* () {
      const current = yield* Ref.get(state)
      const settlement = LlmState.inspectSettlement(current)
      if (LlmState.Settlement.$is("Done")(settlement))
        yield* Ref.set(state, LlmState.markSettled(current))
      return settlement
    }),
  )

  const awaitSettlement = (): Effect.Effect<
    void,
    LlmControllerError | LlmSettlementError
  > =>
    Effect.suspend(() =>
      Effect.flatMap(
        inspectSettlement,
        LlmState.Settlement.$match({
          Done: () => Effect.void,
          Fail: ({ error }) => Effect.fail(error),
          Wait: () => Effect.andThen(Queue.take(changes), awaitSettlement()),
        }),
      ),
    )

  const failSettlementTimeout = lock.withPermit(
    Effect.gen(function* () {
      const current = yield* Ref.get(state)
      const error = LlmState.settlementTimeoutError(current)
      const failure = controllerError("settle", error)
      yield* Ref.set(
        state,
        LlmState.markSettled({
          ...current,
          failure: current.failure ?? failure,
        }),
      )
      yield* failCompletions(current.sendCompletions, failure)
      yield* notify
      return error
    }),
  )

  const settle = Effect.fn("LlmController.settle")(function* () {
    yield* Effect.yieldNow
    yield* lock.withPermit(
      Effect.gen(function* () {
        yield* Ref.update(state, LlmState.beginSettling)
        yield* drainLocked()
        yield* notify
      }),
    )
    yield* awaitSettlement().pipe(
      Effect.timeoutOrElse({
        duration: settlementTimeout,
        orElse: () => Effect.flatMap(failSettlementTimeout, Effect.fail),
      }),
      Effect.tapError((error) =>
        error instanceof LlmSettlementError
          ? FiberSet.clear(tasks)
          : Effect.void,
      ),
    )
  })

  const shutdown = Effect.fn("LlmController.shutdown")(function* () {
    const active = yield* Ref.get(attached)
    if (active !== undefined) {
      yield* Ref.set(attached, undefined)
      yield* Scope.close(active.scope, Exit.void)
    }
    yield* lock.withPermit(
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        const failure =
          current.failure ??
          controllerError("shutdown", "LLM controller is closed")
        yield* Ref.set(state, LlmState.close(current, failure))
        yield* failCompletions(current.sendCompletions, failure)
        yield* notify
      }),
    )
    yield* FiberSet.clear(tasks)
  })

  if (initialBackend !== undefined) yield* attach(initialBackend)

  return {
    attach,
    queue,
    send,
    serve,
    title,
    settle,
    shutdown,
    failure: Deferred.await(failureSignal),
  } satisfies Controller
})

/** Builds a response stream from output values. */
export const response = (
  ...output: ReadonlyArray<Llm.Output>
): LlmResponder.Response => Stream.fromIterable(output)

function isBackendConnection(
  value: BackendConnection | Options | undefined,
): value is BackendConnection {
  return value !== undefined && "rpc" in value
}

export * as LlmController from "./llm-controller.js"
