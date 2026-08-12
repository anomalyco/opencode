import { createHash } from "node:crypto"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { RpcClientError } from "effect/unstable/rpc"
import {
  SimulationCompatibilityError,
  SimulationConnectionError,
  type BackendConnection,
} from "../simulation/connector.js"
import { Backend } from "../simulation/protocol.js"
import { SimulationRequestError } from "../simulation/rpc.js"
import {
  LifecycleError,
  type AttachParams,
  type Cancellation,
  type DynamicControls,
  type Invocation,
  type Output,
  type Progress,
} from "./types.js"

export interface BackendAttachment {
  readonly detach: () => Effect.Effect<void>
}

export interface Controller {
  readonly controls: DynamicControls
  readonly connect: (backend: BackendConnection) => Effect.Effect<BackendAttachment, LifecycleError>
  readonly connectFrom: <E, R>(
    backend: Effect.Effect<BackendConnection, E, R>,
  ) => Effect.Effect<
    { readonly backend: BackendConnection; readonly attachment: BackendAttachment },
    E | LifecycleError,
    R
  >
  readonly endGeneration: Effect.Effect<void>
  readonly settle: Effect.Effect<void, LifecycleError>
  readonly shutdown: Effect.Effect<void>
  readonly failure: Effect.Effect<never, LifecycleError>
}

type Waiter = {
  readonly callID?: string
  readonly resume: (effect: Effect.Effect<Invocation, LifecycleError>) => void
  delivered?: Active
}

type Active = {
  readonly fingerprint: string
  readonly call: Invocation
  readonly cancelled: Deferred.Deferred<Cancellation>
  readonly operations: Semaphore.Semaphore
  claimed: boolean
  sequence: number
  state: "pending" | "settled" | "cancelled"
}

type AttachmentIntent = {
  readonly params: AttachParams
  previous: AttachmentIntent | undefined
  readonly rejection: Deferred.Deferred<never, LifecycleError>
  attempted: boolean
}

const decodeAttach = Schema.decodeUnknownEffect(Backend.ToolAttachParams)
const decodeProgress = Schema.decodeUnknownEffect(Backend.ToolProgress)
const decodeOutput = Schema.decodeUnknownEffect(Backend.ToolOutput)
const decodeFailure = Schema.decodeUnknownEffect(Schema.String)
const decodeCallID = Schema.decodeUnknownEffect(Schema.String)

export const make = Effect.fn("ToolProducer.make")(function* (
  staticNames: ReadonlySet<string>,
) {
  const parentScope = yield* Scope.Scope
  const lifecycle = yield* Semaphore.make(1)
  const attachmentCalls = yield* Semaphore.make(1)
  const attachmentLock = yield* Semaphore.make(1)
  const connectionCalls = yield* Semaphore.make(1)
  const records = new Map<string, Active>()
  const waiters: Waiter[] = []
  const completed = new Map<string, string>()
  const unclaimedCancellations: Active[] = []
  const backendChanges = yield* Queue.sliding<void>(1)
  const failure = yield* Deferred.make<never, LifecycleError>()
  const settlementStarted = yield* Deferred.make<void>()
  const current = yield* Ref.make<
    | {
        readonly backend: BackendConnection
        readonly scope: Scope.Scope
        readonly disconnected: Deferred.Deferred<void>
      }
    | undefined
  >(undefined)
  let desired: AttachmentIntent | undefined
  let acknowledged: AttachmentIntent | undefined
  let terminalFailure: LifecycleError | undefined
  let generationActive = false
  let generationEnded = Deferred.makeUnsafe<void>()
  let settling = false
  let settled = false
  let closed = false

  const lifecycleError = (
    operation: LifecycleError["operation"],
    reason: LifecycleError["reason"],
    message: string,
    callID?: string,
  ) =>
    new LifecycleError({
      operation,
      reason,
      message,
      ...(callID === undefined ? {} : { callID }),
    })

  const rejectIntent = (intent: AttachmentIntent, error: LifecycleError) =>
    Effect.sync(() => {
      if (desired === intent) desired = intent.previous
      if (acknowledged === intent) acknowledged = intent.previous
      Deferred.doneUnsafe(intent.rejection, Effect.fail(error))
    })

  const publishFailure = (error: LifecycleError) =>
    Effect.sync(() => {
      if (terminalFailure !== undefined) return
      terminalFailure = error
      Deferred.doneUnsafe(failure, Effect.fail(error))
    })

  const notifyBackend = Queue.offer(backendChanges, undefined).pipe(Effect.asVoid)

  const remember = (id: string, fingerprint: string) => {
    completed.set(id, fingerprint)
    if (completed.size > 256) {
      const oldest = completed.keys().next().value
      if (oldest !== undefined) completed.delete(oldest)
    }
  }

  const retainCancellation = (record: Active) => {
    unclaimedCancellations.push(record)
    if (unclaimedCancellations.length <= 256) return
    const oldest = unclaimedCancellations.shift()
    if (
      oldest !== undefined &&
      records.get(oldest.call.id) === oldest &&
      oldest.state === "cancelled" &&
      !oldest.claimed
    )
      records.delete(oldest.call.id)
  }

  const deliver = (record: Active) => {
    const callID = record.call.context.callID
    const exact = waiters.findIndex((waiter) => waiter.callID === callID)
    const index =
      exact >= 0
        ? exact
        : waiters.findIndex((waiter) => waiter.callID === undefined)
    if (index < 0) {
      record.claimed = false
      return
    }
    const waiter = waiters.splice(index, 1)[0]
    if (waiter === undefined)
      throw new Error(`missing dynamic tool waiter for ${record.call.id}`)
    record.claimed = true
    waiter.delivered = record
    waiter.resume(Effect.succeed(record.call))
    if (record.state === "cancelled") records.delete(record.call.id)
  }

  const awaitBackend = (
    operation: LifecycleError["operation"],
    callID: string | undefined,
  ): Effect.Effect<BackendConnection, LifecycleError> =>
    Effect.suspend(() =>
      closed
        ? Effect.fail(
            lifecycleError(
              operation,
              "controller-closed",
              "dynamic tool controller is closed",
              callID,
            ),
          )
        : Ref.get(current).pipe(
            Effect.flatMap((attached) =>
              attached === undefined
                ? Queue.take(backendChanges).pipe(
                    Effect.andThen(awaitBackend(operation, callID)),
                  )
                : Effect.succeed(attached.backend),
            ),
          ),
    )

  const whileConnected = <A, E>(
    backend: BackendConnection,
    operation: LifecycleError["operation"],
    effect: Effect.Effect<A, E>,
  ) =>
    Effect.raceFirst(
      effect,
      backend.closed.pipe(
        Effect.andThen(
          Effect.fail(
            new SimulationConnectionError({
              endpoint: backend.endpoint,
              operation,
              message: `dynamic tool ${operation} connection closed`,
            }),
          ),
        ),
      ),
    )

  const request = <A>(
    operation: LifecycleError["operation"],
    callID: string | undefined,
    send: (backend: BackendConnection) => Effect.Effect<A, unknown>,
  ): Effect.Effect<A, LifecycleError> =>
    Effect.gen(function* () {
      if (closed)
        return yield* Effect.fail(
          lifecycleError(
            operation,
            "controller-closed",
            "dynamic tool controller is closed",
            callID,
          ),
        )
      const backend = yield* awaitBackend(operation, callID)
      const result = yield* Effect.exit(
        whileConnected(backend, operation, send(backend)),
      )
      if (Exit.isSuccess(result)) return result.value
      if (Cause.hasInterrupts(result.cause)) return yield* Effect.interrupt
      const found = Cause.findErrorOption(result.cause)
      if (found._tag === "None") {
        const defect = Cause.squash(result.cause)
        if (Schema.isSchemaError(defect))
          return yield* Effect.fail(
            lifecycleError(operation, "rejected", defect.message, callID),
          )
        return yield* Effect.die(defect)
      }
      if (
        found.value instanceof SimulationRequestError ||
        found.value instanceof SimulationCompatibilityError
      )
        return yield* Effect.fail(
          lifecycleError(operation, "rejected", found.value.message, callID),
        )
      if (
        !(found.value instanceof SimulationConnectionError) &&
        !(
          found.value instanceof RpcClientError.RpcClientError &&
          isTransientRpcError(found.value)
        )
      )
        return yield* Effect.fail(
          lifecycleError(operation, "rejected", String(found.value), callID),
        )
      yield* Effect.sleep(25)
      return yield* request(operation, callID, send)
    })

  const unavailable = (
    record: Active,
    operation: LifecycleError["operation"],
  ) =>
    record.state === "pending"
      ? undefined
      : lifecycleError(
          operation,
          record.state === "settled" ? "already-settled" : "cancelled",
          record.state === "settled"
            ? `dynamic tool call ${record.call.context.callID} is settled`
            : `dynamic tool call ${record.call.context.callID} was cancelled`,
          record.call.context.callID,
        )

  const operate = <A>(
    record: Active,
    operation: "progress" | "finish" | "fail",
    effect: Effect.Effect<A, LifecycleError>,
  ) =>
    record.operations.withPermit(
      Effect.suspend(() => {
        const error = unavailable(record, operation)
        if (error !== undefined) return Effect.fail(error)
        return Effect.raceFirst(
          effect,
          Deferred.await(record.cancelled).pipe(
            Effect.andThen(
              Effect.fail(
                lifecycleError(
                  operation,
                  "cancelled",
                  `dynamic tool call ${record.call.context.callID} was cancelled`,
                  record.call.context.callID,
                ),
              ),
            ),
          ),
        )
      }),
    )

  const commit = (
    record: Active,
    operation: "finish" | "fail",
    effect: Effect.Effect<unknown, LifecycleError>,
  ) =>
    operate(
      record,
      operation,
      effect.pipe(
        Effect.andThen(
          Effect.sync(() => {
            record.state = "settled"
            records.delete(record.call.id)
            remember(record.call.id, record.fingerprint)
          }),
        ),
      ),
    )

  const makeInvocation = (
    invocation: Backend.ToolInvocation,
    fingerprint: string,
  ): Active => {
    const cancelled = Deferred.makeUnsafe<Cancellation>()
    const operations = Semaphore.makeUnsafe(1)
    let record: Active
    const call: Invocation = {
      id: invocation.id,
      name: invocation.name,
      input: invocation.input,
      context: invocation.context,
      progress: (update: Progress) =>
        operate(
          record,
          "progress",
          decodeProgress(update).pipe(
            Effect.mapError((error) =>
              lifecycleError(
                "progress",
                "rejected",
                error.message,
                invocation.context.callID,
              ),
            ),
            Effect.flatMap((decoded) =>
              request("progress", invocation.context.callID, (backend) =>
                backend.updateTool({
                  id: invocation.id,
                  sequence: record.sequence,
                  update: decoded,
                }),
              ),
            ),
            Effect.andThen(
              Effect.sync(() => {
                record.sequence++
              }),
            ),
          ),
        ),
      finish: (output: Output) =>
        commit(
          record,
          "finish",
          decodeOutput(output).pipe(
            Effect.mapError((error) =>
              lifecycleError(
                "finish",
                "rejected",
                error.message,
                invocation.context.callID,
              ),
            ),
            Effect.flatMap((decoded) =>
              request("finish", invocation.context.callID, (backend) =>
                backend.finishTool({ id: invocation.id, output: decoded }),
              ),
            ),
          ),
        ),
      fail: (message) =>
        commit(
          record,
          "fail",
          decodeFailure(message).pipe(
            Effect.mapError((error) =>
              lifecycleError(
                "fail",
                "rejected",
                error.message,
                invocation.context.callID,
              ),
            ),
            Effect.flatMap((decoded) =>
              request("fail", invocation.context.callID, (backend) =>
                backend.failTool({ id: invocation.id, message: decoded }),
              ),
            ),
          ),
        ),
      awaitCancelled: () => Deferred.await(cancelled),
    }
    record = {
      fingerprint,
      call,
      cancelled,
      operations,
      claimed: false,
      sequence: 0,
      state: "pending",
    }
    return record
  }

  const receiveInvocation = (invocation: Backend.ToolInvocation) =>
    lifecycle.withPermit(
      Effect.gen(function* () {
        const fingerprint = fingerprintJson(invocation)
        const existing = records.get(invocation.id)
        if (existing !== undefined) {
          if (existing.fingerprint !== fingerprint)
            yield* publishFailure(
              lifecycleError(
                "take",
                "rejected",
                `dynamic tool invocation ${invocation.id} was replayed with different input`,
                invocation.context.callID,
              ),
            )
          return
        }
        const settled = completed.get(invocation.id)
        if (settled !== undefined) {
          if (settled !== fingerprint)
            yield* publishFailure(
              lifecycleError(
                "take",
                "rejected",
                `dynamic tool invocation ${invocation.id} was reused with different input`,
                invocation.context.callID,
              ),
            )
          return
        }
        const record = makeInvocation(invocation, fingerprint)
        records.set(invocation.id, record)
        deliver(record)
      }),
    )

  const receiveCancellation = (cancellation: Cancellation) =>
    lifecycle.withPermit(
      Effect.sync(() => {
        const record = records.get(cancellation.id)
        if (record === undefined || record.state !== "pending") return
        record.state = "cancelled"
        remember(cancellation.id, record.fingerprint)
        Deferred.doneUnsafe(record.cancelled, Effect.succeed(cancellation))
        if (record.claimed) records.delete(cancellation.id)
        else {
          deliver(record)
          if (!record.claimed) retainCancellation(record)
        }
      }),
    )

  const connectBackend: Controller["connect"] = (backend) =>
    lifecycle.withPermit(
      Effect.gen(function* () {
        if (closed)
          return yield* Effect.fail(
            lifecycleError(
              "attach",
              "controller-closed",
              "dynamic tool controller is closed",
            ),
          )
        if ((yield* Ref.get(current)) !== undefined)
          return yield* Effect.fail(
            lifecycleError(
              "attach",
              "rejected",
              "dynamic tool backend is already connected",
            ),
          )
        const scope = yield* Scope.fork(parentScope)
        yield* backend.toolEvents.pipe(
          Stream.runForEach((event) => {
            if (event.type === "invocation")
              return receiveInvocation(event.invocation)
            if (event.type === "cancellation")
              return receiveCancellation(event.cancellation)
            return Deferred.succeed(event.completed, undefined).pipe(
              Effect.asVoid,
            )
          }),
          Effect.matchCauseEffect({
              onFailure: (cause) => {
                const error = lifecycleError(
                "take",
                "rejected",
                  `dynamic tool event stream failed: ${Cause.pretty(cause)}`,
                )
                return publishFailure(error)
            },
            onSuccess: () => Effect.void,
          }),
          Effect.forkIn(scope),
        )
        let replayed: AttachmentIntent | undefined
        const applied = yield* Effect.exit(
          attachmentLock.withPermit(
            Effect.suspend(() => {
              const intent = desired
              if (intent === undefined) return Effect.void
              replayed = intent
              intent.attempted = true
              const reject = (error: unknown) =>
                lifecycleError(
                  "attach",
                  isTransientConnectionError(error)
                    ? "transport-interrupted"
                    : "rejected",
                  String(error),
                )
              return whileConnected(
                backend,
                "attach",
                backend.attachTools(intent.params.tools),
              ).pipe(
                Effect.tapError((error) =>
                  error instanceof SimulationRequestError ||
                  error instanceof SimulationCompatibilityError
                    ? rejectIntent(intent, reject(error))
                    : Effect.void,
                ),
                Effect.mapError(reject),
              )
            }),
          ),
        )
        if (Exit.isFailure(applied)) {
          yield* Scope.close(scope, Exit.void)
          const defect = Cause.squash(applied.cause)
          if (Schema.isSchemaError(defect)) {
            const error = lifecycleError("attach", "rejected", defect.message)
            if (replayed !== undefined) yield* rejectIntent(replayed, error)
            return yield* Effect.fail(error)
          }
          const found = Cause.findErrorOption(applied.cause)
          if (
            replayed !== undefined &&
            found._tag === "Some" &&
            found.value instanceof LifecycleError &&
            found.value.reason === "rejected"
          )
            yield* rejectIntent(replayed, found.value)
          return yield* Effect.failCause(applied.cause)
        }
        yield* Effect.sync(() => {
          if (!generationActive) generationEnded = Deferred.makeUnsafe<void>()
          generationActive = true
        })
        const disconnected = Deferred.makeUnsafe<void>()
        yield* Ref.set(current, { backend, scope, disconnected })
        yield* notifyBackend
        const detach = Effect.fn("ToolProducer.detach")(function* () {
          const shouldClose = yield* lifecycle.withPermit(
            Effect.gen(function* () {
              const attached = yield* Ref.get(current)
              if (attached?.backend !== backend) return false
              yield* Ref.set(current, undefined)
              Deferred.doneUnsafe(disconnected, Effect.void)
              yield* notifyBackend
              return true
            }),
          )
          if (shouldClose) yield* Scope.close(scope, Exit.void)
        })
        return { detach }
      }),
    )

  const connectionClosed = () =>
    lifecycleError(
      "attach",
      "controller-closed",
      "dynamic tool controller is settled",
    )

  const connect: Controller["connect"] = (backend) =>
    connectionCalls.withPermit(
      Effect.suspend(() =>
        settled ? Effect.fail(connectionClosed()) : connectBackend(backend),
      ),
    )

  const connectFrom: Controller["connectFrom"] = (backend) =>
    connectionCalls.withPermit(
      Effect.suspend(() =>
        settled
          ? Effect.fail(connectionClosed())
          : backend.pipe(
              Effect.flatMap((backend) =>
                connectBackend(backend).pipe(
                  Effect.map((attachment) => ({ backend, attachment })),
                ),
              ),
            ),
      ),
    )

  const replace = (params: AttachParams, duringSettlement = false) =>
    Effect.gen(function* () {
      const previous = acknowledged
      const intent: AttachmentIntent = {
        params,
        previous,
        rejection: Deferred.makeUnsafe<never, LifecycleError>(),
        attempted: false,
      }
      desired = intent
      const rollback = Effect.sync(() => {
        if (desired === intent) desired = previous
      })
      const apply = Effect.raceFirst(
        request("attach", undefined, (backend) =>
          attachmentLock.withPermit(
            Effect.suspend(() => {
              if (desired !== intent) return Effect.succeed({ attached: true as const })
              intent.attempted = true
              return backend.attachTools(params.tools).pipe(
                Effect.tapError((error) => {
                  if (!(error instanceof SimulationRequestError) && !(error instanceof SimulationCompatibilityError))
                    return Effect.void
                  return rejectIntent(intent, lifecycleError("attach", "rejected", error.message))
                }),
              )
            }),
          ),
        ).pipe(
          Effect.tapError((error) => (error.reason === "rejected" ? rejectIntent(intent, error) : Effect.void)),
          Effect.tapError(() => (intent.attempted ? Effect.void : rollback)),
          Effect.onInterrupt(() => (intent.attempted ? Effect.void : rollback)),
        ),
        Deferred.await(intent.rejection),
      )
      yield* duringSettlement
        ? apply
        : Effect.raceFirst(
            apply,
            Deferred.await(settlementStarted).pipe(
              Effect.andThen(
                Effect.fail(lifecycleError("attach", "controller-closed", "dynamic tool controller is settling")),
              ),
            ),
          )
      if (desired === intent) {
        intent.previous = undefined
        acknowledged = intent
      }
    })

  const attach: DynamicControls["attach"] = (params) =>
    Effect.gen(function* () {
      const decoded = yield* decodeAttach(params).pipe(
        Effect.mapError((error) =>
          lifecycleError("attach", "rejected", error.message),
        ),
      )
      const collision = decoded.tools
        .map(Backend.exposedToolName)
        .find((name) => staticNames.has(name))
      if (collision !== undefined)
        yield* Effect.fail(
          lifecycleError(
            "attach",
            "rejected",
            `dynamic tool conflicts with configured static adapter: ${collision}`,
          ),
        )
      yield* attachmentCalls.withPermit(
        Effect.suspend(() =>
          settling
            ? Effect.fail(lifecycleError("attach", "controller-closed", "dynamic tool controller is settling"))
            : replace(decoded),
        ),
      )
      return undefined
    })

  function take(): Effect.Effect<Invocation, LifecycleError>
  function take(callID: string): Effect.Effect<Invocation, LifecycleError>
  function take(callID?: string): Effect.Effect<Invocation, LifecycleError> {
    const decoded: Effect.Effect<string | undefined, LifecycleError> =
      callID === undefined
        ? Effect.succeed(undefined)
        : decodeCallID(callID).pipe(
            Effect.mapError((error) =>
              lifecycleError("take", "rejected", error.message),
            ),
          )
    return decoded.pipe(
      Effect.flatMap((callID) =>
        Effect.callback<Invocation, LifecycleError>((resume) => {
          if (closed || settled) {
            resume(
              Effect.fail(
                lifecycleError(
                  "take",
                  "controller-closed",
                  settled ? "dynamic tool controller is settled" : "dynamic tool controller is closed",
                  callID,
                ),
              ),
            )
            return undefined
          }
          if (
            callID !== undefined &&
            (Array.from(records.values()).some(
              (record) =>
                record.call.context.callID === callID && record.claimed,
            ) ||
              waiters.some((waiter) => waiter.callID === callID))
          ) {
            resume(
              Effect.fail(
                lifecycleError(
                  "take",
                  "already-claimed",
                  `dynamic tool call is already claimed: ${callID}`,
                  callID,
                ),
              ),
            )
            return undefined
          }
          let record = Array.from(records.values()).find(
            (candidate) =>
              !candidate.claimed &&
              (callID === undefined ||
                candidate.call.context.callID === callID),
          )
          if (record !== undefined) {
            record.claimed = true
            resume(Effect.succeed(record.call))
            if (record.state === "cancelled") records.delete(record.call.id)
            return Effect.sync(() => {
              if (
                record !== undefined &&
                records.get(record.call.id) === record
              ) {
                record.claimed = false
                deliver(record)
              }
            })
          }
          const waiter: Waiter = { callID, resume }
          waiters.push(waiter)
          return Effect.sync(() => {
            const index = waiters.indexOf(waiter)
            if (index >= 0) waiters.splice(index, 1)
            else if (waiter.delivered !== undefined) {
              record = waiter.delivered
              if (records.get(record.call.id) === record) {
                record.claimed = false
                deliver(record)
              }
            }
          })
        }),
      ),
    )
  }

  const endGeneration = lifecycle.withPermit(
    Effect.gen(function* () {
      generationActive = false
      Deferred.doneUnsafe(generationEnded, Effect.void)
      const attached = yield* Ref.get(current)
      if (attached !== undefined) {
        yield* Ref.set(current, undefined)
        Deferred.doneUnsafe(attached.disconnected, Effect.void)
        yield* Scope.close(attached.scope, Exit.void)
      }
      for (const record of records.values()) {
        if (record.state !== "pending") continue
        record.state = "cancelled"
        Deferred.doneUnsafe(
          record.cancelled,
          Effect.succeed({ id: record.call.id, reason: "interrupted" }),
        )
      }
      records.clear()
      completed.clear()
      unclaimedCancellations.length = 0
      yield* notifyBackend
    }),
  )

  function commitSettlement(): Effect.Effect<void, LifecycleError> {
    return Effect.gen(function* () {
      const retryAfter = yield* connectionCalls.withPermit(
        Effect.gen(function* () {
          const attached = yield* Ref.get(current)
          if (generationActive && attached === undefined)
            return generationEnded
          if (generationActive && attached !== undefined) {
            const drained = yield* Effect.raceFirst(
              attached.backend.flushToolEvents().pipe(
                Effect.mapError((error) =>
                  lifecycleError("take", "rejected", error.message),
                ),
                Effect.as(true),
              ),
              Deferred.await(attached.disconnected).pipe(Effect.as(false)),
            )
            if (!drained) return generationEnded
          }
          if (terminalFailure !== undefined)
            return yield* Effect.fail(terminalFailure)
          yield* lifecycle.withPermit(
            Effect.suspend(() => {
              if (terminalFailure !== undefined)
                return Effect.fail(terminalFailure)
              const pending = Array.from(records.values()).filter(
                (record) => record.state === "pending",
              ).length
              if (pending > 0)
                return Effect.fail(
                  lifecycleError(
                    "take",
                    "rejected",
                    `${pending} dynamic tool invocation(s) remain unsettled`,
                  ),
                )
              return Effect.sync(() => {
                settled = true
                for (const waiter of waiters)
                  waiter.resume(
                    Effect.fail(
                      lifecycleError(
                        "take",
                        "controller-closed",
                        "dynamic tool controller is settled",
                        waiter.callID,
                      ),
                    ),
                  )
                waiters.length = 0
              })
            }),
          )
          return undefined
        }),
      )
      if (retryAfter === undefined) return
      yield* Effect.raceFirst(
        Deferred.await(retryAfter),
        Effect.raceFirst(
          awaitBackend("take", undefined).pipe(Effect.asVoid),
          Deferred.await(failure),
        ),
      )
      yield* commitSettlement()
    })
  }

  const settle = Effect.sync(() => {
    settling = true
    Deferred.doneUnsafe(settlementStarted, Effect.void)
  }).pipe(
    Effect.andThen(
      attachmentCalls.withPermit(
        Effect.gen(function* () {
          yield* connectionCalls.withPermit(Effect.void)
          if (terminalFailure !== undefined)
            return yield* Effect.fail(terminalFailure)
          if (generationActive && desired !== undefined) {
            const ended = generationEnded
            if (desired.params.tools.length > 0)
              yield* Effect.raceFirst(
                replace({ tools: [] }, true),
                Deferred.await(ended),
              )
            if (generationActive)
              yield* Effect.raceFirst(
                request("take", undefined, (backend) =>
                  backend.flushToolEvents(),
                ),
                Deferred.await(ended),
              )
          }
          if (terminalFailure !== undefined)
            return yield* Effect.fail(terminalFailure)
          yield* commitSettlement()
          return undefined
        }),
      ),
    ),
  )

  const shutdown = Effect.suspend(() => {
    if (closed) return Effect.void
    return Effect.sync(() => {
      closed = true
      for (const waiter of waiters)
        waiter.resume(
          Effect.fail(
            lifecycleError(
              "take",
              "controller-closed",
              "dynamic tool controller is closed",
              waiter.callID,
            ),
          ),
        )
      waiters.length = 0
    }).pipe(
      Effect.andThen(endGeneration),
      Effect.ensuring(Queue.shutdown(backendChanges)),
    )
  })

  yield* Effect.addFinalizer(() => shutdown)

  return {
    controls: { attach, take },
    connect,
    connectFrom,
    endGeneration,
    settle,
    shutdown,
    failure: Deferred.await(failure),
  } satisfies Controller
})

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    )
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? String(value)
}

function fingerprintJson(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("base64url")
}

function isTransientConnectionError(error: unknown) {
  return (
    error instanceof SimulationConnectionError ||
    (error instanceof RpcClientError.RpcClientError &&
      isTransientRpcError(error))
  )
}

function isTransientRpcError(error: RpcClientError.RpcClientError) {
  if (error.reason._tag !== "RpcClientDefect") return true
  const message = error.reason.message
  return (
    message.startsWith("cannot connect") ||
    message === "connection closed" ||
    message === "connection error" ||
    message === "connection is not open" ||
    message === "failed to send request"
  )
}

export * as ToolProducer from "./producer.js"
