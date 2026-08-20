export * as BackgroundJob from "./background-job"

import { Cause, Clock, Context, Deferred, Effect, Exit, Layer, Ref, Scope, SynchronizedRef } from "effect"
import { Identifier } from "./id/id"
import { makeGlobalNode } from "./effect/app-node"

export type Status = "running" | "completed" | "error" | "cancelled"

export type Info = {
  id: string
  type: string
  title?: string
  status: Status
  started_at: number
  completed_at?: number
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

/**
 * Exact identity for one cancellable lifetime. Public ids are reusable, so the opaque token prevents
 * a stale caller from waiting on or cancelling a replacement.
 */
export type Lifetime = {
  readonly id: string
  readonly token: object
}

/** One accepted invocation; sequence orders work but cancellation and terminal status are lifetime-wide. */
export type Invocation = {
  readonly lifetime: Lifetime
  readonly sequence: number
}

/** Fieldless process-local invocation identity authenticated by registry WeakMap membership. */
declare const InvocationHandleType: unique symbol
export type InvocationHandle = object & { readonly [InvocationHandleType]: true }

export type LifetimeState = "registered_unarmed" | "binding" | "armed" | "terminal"

export type PermitState = "issued" | "consumed" | "revoked"

/**
 * Authority to arm one invocation. Registry claim and issuer revocation race on one lock-free cell,
 * avoiding a nested call into the issuer's authority lock.
 */
export type ArmPermit = {
  readonly lifetime: Lifetime
  readonly sequence: number
  readonly claim: Effect.Effect<boolean>
}

export type BindDecision =
  | { readonly kind: "arm_allowed"; readonly permit: ArmPermit }
  | { readonly kind: "cancellation_owned" }
  | { readonly kind: "rejected"; readonly reason: string }

/** One exact lifetime winner, selected by the registry and published to its admission authority. */
export type TerminalInput = {
  readonly lifetime: Lifetime
  readonly winner: Exclude<Status, "running">
}

/** Opaque admission coordinates relayed to the higher layer that can validate them. */
export type Admission = {
  readonly lease: string
  readonly epoch: bigint
}

/**
 * Binder input keeps admission separate from observable invocation identity. The cross-package
 * boundary permits absence so a binder can explicitly reject it rather than assume the producer.
 */
export type BindRequest = {
  readonly lifetime: Lifetime
  readonly sequence: number
  readonly admission?: Admission
}

/**
 * Decides admission before forking, with no registry lock held. `terminal` publishes the exact
 * lifetime winner before completion becomes visible to waiters.
 */
export interface Binder {
  readonly bind: (input: BindRequest) => Effect.Effect<BindDecision>
  readonly terminal: (input: TerminalInput) => Effect.Effect<void>
}

/** Grants every request. The behavior when no admission authority is wired. */
export const permissiveBinder: Binder = {
  bind: (input) =>
    Ref.make<PermitState>("issued").pipe(
      Effect.map((state) => ({
        kind: "arm_allowed" as const,
        permit: {
          lifetime: input.lifetime,
          sequence: input.sequence,
          claim: Ref.modify(state, (current) => [current === "issued", current === "issued" ? "consumed" : current]),
        },
      })),
    ),
  terminal: () => Effect.void,
}

/**
 * Builds a permit and the revocation half of its cell. The issuer keeps `revoke`; the
 * registry receives `permit`. Both act on the same cell, so exactly one of them wins.
 */
export const makePermit = (lifetime: Lifetime, sequence: number) =>
  Ref.make<PermitState>("issued").pipe(
    Effect.map((state) => ({
      permit: {
        lifetime,
        sequence,
        claim: Ref.modify(state, (current) => [current === "issued", current === "issued" ? "consumed" : current]),
      } satisfies ArmPermit,
      revoke: Ref.modify(state, (current: PermitState) => [
        current === "issued",
        current === "issued" ? ("revoked" as PermitState) : current,
      ]),
      read: Ref.get(state),
    })),
  )

/**
 * Shared arm result. A handle remains valid after this lifetime settles; it is absent only when the
 * token terminalized without arming, so a joiner cannot adopt a later same-id replacement.
 */
type ArmOutcome =
  | { readonly info: Info; readonly lifetime?: undefined; readonly handle?: undefined }
  | { readonly info: Info; readonly lifetime: Lifetime; readonly handle: InvocationHandle }

type LifetimeLedger = {
  readonly lifetime: Lifetime
  readonly done: Deferred.Deferred<Info>
  readonly handles: Map<number, InvocationHandle>
  state: LifetimeState
  info: Info
  output?: { sequence: number; text: string }
}

type InvocationBinding = { readonly ledger: LifetimeLedger; readonly sequence: number }

type Active = {
  info: Info
  done: Deferred.Deferred<Info>
  scope: Scope.Closeable
  token: object
  state: LifetimeState
  /** One shared arm attempt per token. Concurrent starts join it; they never bind twice. */
  arm: Deferred.Deferred<ArmOutcome>
  accepted: ReadonlySet<number>
  pending: number
  next: number
  output?: { sequence: number; text: string }
  tail: Deferred.Deferred<void>
  promoted: Deferred.Deferred<Info>
  onPromote?: Effect.Effect<void>
  readonly ledger: LifetimeLedger
}

type State = {
  jobs: SynchronizedRef.SynchronizedRef<Map<string, Active>>
  scope: Scope.Scope
}

type FinishResult = {
  info?: Info
  done?: Deferred.Deferred<Info>
  scope?: Scope.Closeable
  arm?: Deferred.Deferred<ArmOutcome>
  terminal?: TerminalInput
}

type PromoteResult = {
  info?: Info
  promoted?: Deferred.Deferred<Info>
  onPromote?: Effect.Effect<void>
}

type StartResult =
  | { kind: "adopted"; info: Info; token: object; handle?: InvocationHandle }
  | { kind: "joined"; arm: Deferred.Deferred<ArmOutcome> }
  | { kind: "publishing"; done: Deferred.Deferred<Info> }
  | { kind: "registrar"; info: Info; scope: Scope.Closeable; token: object; arm: Deferred.Deferred<ArmOutcome> }

type ReserveResult =
  | { kind: "absent" }
  | { kind: "wait"; arm: Deferred.Deferred<ArmOutcome> }
  | {
      kind: "reserved"
      previous: Deferred.Deferred<void>
      scope: Scope.Closeable
      tail: Deferred.Deferred<void>
      token: object
      sequence: number
    }

/**
 * `state` is separate from public status: registered and binding lifetimes already report running,
 * so status alone cannot say whether an invocation has armed.
 */
export type ExactEntry = { readonly lifetime: Lifetime; readonly info: Info; readonly state: LifetimeState }

export type Observation = {
  readonly state: LifetimeState
  readonly accepted: boolean
  readonly status: Status
  readonly output?: string
}

/** `bindings.get(handle)` is the acceptance check; a second always-true `accepted` field is forbidden. */
export type HandleObservation = Omit<Observation, "accepted"> & {
  /** Unordered accepted invocation identities for this lifetime; final when terminal. */
  readonly invocations: ReadonlySet<InvocationHandle>
}

export type StartInput = {
  id?: string
  type: string
  title?: string
  metadata?: Record<string, unknown>
  onPromote?: Effect.Effect<void>
  run: Effect.Effect<string, unknown>
  /** Relayed to the binder for sequence zero; omission is handled by the configured binder. */
  admission?: Admission
}

export type StartExactResult = ArmOutcome

export type ExtendInput = {
  id: string
  run: Effect.Effect<string, unknown>
  /** Each extension carries separate admission; sequence zero's consumed permit cannot be reused. */
  admission?: Admission
}

export type ExtendExactInput = {
  lifetime: Lifetime
  run: Effect.Effect<string, unknown>
  /** Relayed to the binder for the reserved sequence. Optional - see `ExtendInput.admission`. */
  admission?: Admission
}

export type ExtendExactResult =
  | { readonly extended: false }
  | { readonly extended: true; readonly sequence: number; readonly handle: InvocationHandle }

export type WaitInput = {
  id: string
  timeout?: number
}

export type WaitExactInput = {
  lifetime: Lifetime
  timeout?: number
}

export type WaitHandleInput = { readonly handle: InvocationHandle; readonly timeout?: number }

export type WaitResult = {
  info?: Info
  timedOut: boolean
}

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly start: (input: StartInput) => Effect.Effect<Info>
  readonly extend: (input: ExtendInput) => Effect.Effect<boolean>
  /** ID-based extension returning only the opaque accepted invocation identity. */
  readonly extendWithHandle: (input: ExtendInput) => Effect.Effect<InvocationHandle | undefined>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly waitForPromotion: (id: string) => Effect.Effect<Info>
  readonly promote: (id: string) => Effect.Effect<Info | undefined>
  readonly cancel: (id: string) => Effect.Effect<Info | undefined>

  /** Exact-lifetime operations reject or ignore stale handles instead of reaching replacements. */
  readonly startExact: (input: StartInput) => Effect.Effect<StartExactResult>
  readonly listExact: () => Effect.Effect<ExactEntry[]>
  readonly getExact: (lifetime: Lifetime) => Effect.Effect<Info | undefined>
  readonly extendExact: (input: ExtendExactInput) => Effect.Effect<ExtendExactResult>
  readonly waitExact: (input: WaitExactInput) => Effect.Effect<WaitResult>
  readonly waitHandle: (input: WaitHandleInput) => Effect.Effect<WaitResult>
  readonly waitForPromotionExact: (lifetime: Lifetime) => Effect.Effect<Info | undefined>
  readonly promoteExact: (lifetime: Lifetime) => Effect.Effect<Info | undefined>
  readonly cancelExact: (lifetime: Lifetime) => Effect.Effect<Info | undefined>
  readonly observe: (invocation: Invocation) => Effect.Effect<Observation | undefined>
  readonly observeHandle: (handle: InvocationHandle) => Effect.Effect<HandleObservation | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BackgroundJob") {}

function snapshot(job: Active): Info {
  return {
    ...job.info,
    ...(job.info.metadata ? { metadata: { ...job.info.metadata } } : {}),
  }
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** The exact current entry, or undefined when the handle is stale or replaced. */
function exact(jobs: Map<string, Active>, lifetime: Lifetime) {
  const job = jobs.get(lifetime.id)
  if (!job) return undefined
  if (job.token !== lifetime.token) return undefined
  return job
}

/**
 * Makes one scoped, process-local registry. Entries are intentionally not
 * durable: process restart or owner-scope closure loses status and interrupts
 * live work. Persisted observation, restart recovery, and remote workers need a
 * separate durable ownership mechanism rather than pretending this registry has
 * those semantics.
 */
export const makeWith = (binder: Binder) =>
  Effect.gen(function* () {
    const state: State = {
      jobs: yield* SynchronizedRef.make(new Map()),
      scope: yield* Scope.Scope,
    }
    const bindings = new WeakMap<InvocationHandle, InvocationBinding>()
    const mint = (ledger: LifetimeLedger, sequence: number) => {
      const existing = ledger.handles.get(sequence)
      if (existing) return existing
      const handle = Object.freeze(Object.create(null)) as InvocationHandle
      ledger.handles.set(sequence, handle)
      bindings.set(handle, { ledger, sequence })
      return handle
    }
    const updateLedger = (job: Active, next: Active) => {
      job.ledger.state = next.state
      job.ledger.info = snapshot(next)
      job.ledger.output = next.output
    }

    const settle = Effect.fn("BackgroundJob.settle")(function* (
      id: string,
      token: object,
      sequence: number,
      exit: Exit.Exit<string, unknown>,
    ) {
      const completed_at = yield* Clock.currentTimeMillis
      const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [FinishResult, Map<string, Active>] => {
        const job = jobs.get(id)
        if (!job) return [{}, jobs]
        if (job.token !== token) return [{}, jobs]
        if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
        const pending = job.pending - 1
        const output =
          Exit.isSuccess(exit) && (!job.output || sequence > job.output.sequence)
            ? { sequence, text: exit.value }
            : job.output
        if (Exit.isSuccess(exit) && pending > 0) {
          const next = { ...job, pending, output }
          updateLedger(job, next)
          return [{}, new Map(jobs).set(id, next)]
        }
        const status: Exclude<Status, "running"> = Exit.isSuccess(exit)
          ? "completed"
          : Cause.hasInterruptsOnly(exit.cause)
            ? "cancelled"
            : "error"
        const next = {
          ...job,
          onPromote: undefined,
          state: "terminal" as const,
          pending: 0,
          output,
          info: {
            ...job.info,
            status,
            completed_at,
            ...(output ? { output: output.text } : {}),
            ...(Exit.isFailure(exit) ? { error: errorText(Cause.squash(exit.cause)) } : {}),
          },
        }
        updateLedger(job, next)
        return [
          {
            info: snapshot(next),
            done: job.done,
            scope: job.scope,
            terminal: { lifetime: { id, token }, winner: status },
          },
          new Map(jobs).set(id, next),
        ]
      })
      // The registry lock is released, the winner is committed, and the publication
      // barrier is still closed. Every waiter and same-ID replacement joins `done`, so
      // none can outrun the admission authority's exact-token terminal transition.
      if (result.terminal) yield* binder.terminal(result.terminal)
      if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
      if (result.scope) {
        yield* Scope.close(result.scope, Exit.void).pipe(Effect.forkIn(state.scope, { startImmediately: true }))
      }
      return result.info
    })

    const fork = Effect.fn("BackgroundJob.fork")(function* (
      scope: Scope.Scope,
      id: string,
      token: object,
      sequence: number,
      run: Effect.Effect<string, unknown>,
      tail: Deferred.Deferred<void>,
    ) {
      return yield* run.pipe(
        Effect.matchCauseEffect({
          onSuccess: (output) =>
            settle(id, token, sequence, Exit.succeed(output)).pipe(Effect.ensuring(Deferred.succeed(tail, undefined))),
          onFailure: (cause) =>
            Deferred.succeed(tail, undefined).pipe(Effect.andThen(settle(id, token, sequence, Exit.failCause(cause)))),
        }),
        Effect.ensuring(Deferred.succeed(tail, undefined)),
        Effect.asVoid,
        Effect.forkIn(scope, { startImmediately: true }),
      )
    })

    /** Settles an unarmed token and its shared attempt so joiners cannot wait forever. */
    const abandon = Effect.fn("BackgroundJob.abandon")(function* (
      id: string,
      token: object,
      status: Exclude<Status, "running">,
    ) {
      const completed_at = yield* Clock.currentTimeMillis
      const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [FinishResult, Map<string, Active>] => {
        const job = jobs.get(id)
        if (!job || job.token !== token) return [{}, jobs]
        if (job.state === "terminal") return [{ info: snapshot(job) }, jobs]
        const next: Active = {
          ...job,
          onPromote: undefined,
          state: "terminal",
          pending: 0,
          info: { ...job.info, status, completed_at },
        }
        updateLedger(job, next)
        return [
          {
            info: snapshot(next),
            done: job.done,
            scope: job.scope,
            arm: job.arm,
            terminal: { lifetime: { id, token }, winner: status },
          },
          new Map(jobs).set(id, next),
        ]
      })
      if (result.terminal) yield* binder.terminal(result.terminal)
      if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
      if (result.info && result.arm) yield* Deferred.succeed(result.arm, { info: result.info }).pipe(Effect.ignore)
      if (result.scope) yield* Scope.close(result.scope, Exit.void).pipe(Effect.ignore)
      return result.info
    })

    /**
     * Releases a reserved-but-unarmed extension coordinate. The tail is opened so any
     * later invocation chained behind it still runs, and pending is returned to its
     * prior value so the lifetime can still settle. The sequence number itself is
     * spent - coordinates are monotonic and gaps are legitimate.
     */
    const unreserve = Effect.fn("BackgroundJob.unreserve")(function* (
      id: string,
      token: object,
      tail: Deferred.Deferred<void>,
    ) {
      yield* SynchronizedRef.update(state.jobs, (jobs) => {
        const job = jobs.get(id)
        if (!job || job.token !== token) return jobs
        return new Map(jobs).set(id, { ...job, pending: Math.max(0, job.pending - 1) })
      })
      yield* Deferred.succeed(tail, undefined).pipe(Effect.ignore)
    })

    const list: Interface["list"] = Effect.fn("BackgroundJob.list")(function* () {
      return Array.from((yield* SynchronizedRef.get(state.jobs)).values())
        .map(snapshot)
        .toSorted((a, b) => a.started_at - b.started_at)
    })

    const listExact: Interface["listExact"] = Effect.fn("BackgroundJob.listExact")(function* () {
      return Array.from((yield* SynchronizedRef.get(state.jobs)).values())
        .map((job) => ({ lifetime: { id: job.info.id, token: job.token }, info: snapshot(job), state: job.state }))
        .toSorted((a, b) => a.info.started_at - b.info.started_at)
    })

    const get: Interface["get"] = Effect.fn("BackgroundJob.get")(function* (id) {
      const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
      if (!job) return
      return snapshot(job)
    })

    const getExact: Interface["getExact"] = Effect.fn("BackgroundJob.getExact")(function* (lifetime) {
      const job = exact(yield* SynchronizedRef.get(state.jobs), lifetime)
      if (!job) return
      return snapshot(job)
    })

    const startExact: Interface["startExact"] = Effect.fn("BackgroundJob.startExact")(function* (input) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const id = input.id ?? Identifier.ascending("job")
          const started_at = yield* Clock.currentTimeMillis
          const done = yield* Deferred.make<Info>()
          const promoted = yield* Deferred.make<Info>()
          const tail = yield* Deferred.make<void>()
          const arm = yield* Deferred.make<ArmOutcome>()
          const registration = yield* SynchronizedRef.modifyEffect(
            state.jobs,
            Effect.fnUntraced(function* (jobs) {
              const existing = jobs.get(id)
              // An already armed lifetime is adopted exactly as before: no replacement,
              // no duplicate fork.
              if (existing && existing.state === "armed" && existing.info.status === "running") {
                return [
                  {
                    kind: "adopted",
                    info: snapshot(existing),
                    token: existing.token,
                    handle: existing.ledger.handles.get(0),
                  },
                  jobs,
                ] as readonly [StartResult, Map<string, Active>]
              }
              // An unarmed or binding lifetime already has exactly one arm attempt in
              // flight. Join it. A second caller must not publish its own bind, obtain a
              // permit, or fork.
              if (existing && (existing.state === "registered_unarmed" || existing.state === "binding")) {
                return [{ kind: "joined", arm: existing.arm }, jobs] as readonly [StartResult, Map<string, Active>]
              }
              // A selected winner is not reusable until the admission authority has
              // accepted its exact terminal event. `done` is that publication barrier.
              if (existing && existing.state === "terminal") {
                if (!(yield* Deferred.isDone(existing.done))) {
                  return [{ kind: "publishing", done: existing.done }, jobs] as readonly [
                    StartResult,
                    Map<string, Active>,
                  ]
                }
              }
              const scope = yield* Scope.fork(state.scope, "parallel")
              const token = {}
              const info: Info = {
                id,
                type: input.type,
                title: input.title,
                status: "running",
                started_at,
                metadata: input.metadata,
              }
              const lifetime: Lifetime = { id, token }
              const ledger: LifetimeLedger = {
                lifetime,
                done,
                handles: new Map(),
                state: "registered_unarmed",
                info: { ...info, ...(info.metadata ? { metadata: { ...info.metadata } } : {}) },
              }
              const job: Active = {
                info,
                done,
                scope,
                token,
                state: "registered_unarmed",
                arm,
                accepted: new Set(),
                pending: 1,
                next: 1,
                tail,
                promoted,
                onPromote: input.onPromote,
                ledger,
              }
              return [
                { kind: "registrar", info: snapshot(job), scope, token, arm },
                new Map(jobs).set(id, job),
              ] as readonly [StartResult, Map<string, Active>]
            }),
          )

          if (registration.kind === "adopted") {
            if (!registration.handle) return yield* Effect.die(new Error("Armed lifetime has no invocation handle"))
            return { info: registration.info, lifetime: { id, token: registration.token }, handle: registration.handle }
          }
          if (registration.kind === "publishing") {
            yield* restore(Deferred.await(registration.done))
            return yield* Effect.suspend(() => startExact(input))
          }
          // Use the shared attempt's result rather than current same-id state. Keep the wait
          // interruptible so a settlement defect does not create an unkillable caller.
          if (registration.kind === "joined") return yield* restore(Deferred.await(registration.arm))

          const lifetime: Lifetime = { id, token: registration.token }
          // Registrar/binder failure or interruption terminalizes this exact token,
          // settles the arm attempt and every joiner, and forks nothing.
          const armed = yield* Effect.gen(function* () {
            const decision = yield* restore(binder.bind({ lifetime, sequence: 0, admission: input.admission }))
            if (decision.kind !== "arm_allowed") return undefined
            const claimed = yield* decision.permit.claim
            if (!claimed) return undefined
            return yield* SynchronizedRef.modify(
              state.jobs,
              (
                jobs,
              ): readonly [
                { readonly info: Info; readonly handle: InvocationHandle } | undefined,
                Map<string, Active>,
              ] => {
                const job = jobs.get(id)
                if (!job || job.token !== registration.token) return [undefined, jobs]
                if (job.state !== "registered_unarmed" && job.state !== "binding") return [undefined, jobs]
                const next: Active = { ...job, state: "armed", accepted: new Set([0]) }
                const handle = mint(job.ledger, 0)
                updateLedger(job, next)
                return [{ info: snapshot(next), handle }, new Map(jobs).set(id, next)]
              },
            )
          }).pipe(
            Effect.onExit((exit) =>
              Exit.isSuccess(exit) && exit.value !== undefined
                ? Effect.void
                : abandon(id, registration.token, Exit.isSuccess(exit) ? "cancelled" : "error").pipe(Effect.ignore),
            ),
          )

          if (!armed) return yield* restore(Deferred.await(registration.arm))

          yield* fork(registration.scope, id, registration.token, 0, restore(input.run), tail)
          const outcome: ArmOutcome = { info: armed.info, lifetime, handle: armed.handle }
          yield* Deferred.succeed(registration.arm, outcome).pipe(Effect.ignore)
          return outcome
        }),
      )
    })

    const start: Interface["start"] = Effect.fn("BackgroundJob.start")(function* (input) {
      return (yield* startExact(input)).info
    })

    const reserve = Effect.fn("BackgroundJob.reserve")(function* (id: string, token: object | undefined) {
      const tail = yield* Deferred.make<void>()
      return yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [ReserveResult, Map<string, Active>] => {
        const job = jobs.get(id)
        if (!job) return [{ kind: "absent" }, jobs]
        if (token !== undefined && job.token !== token) return [{ kind: "absent" }, jobs]
        if (job.state === "terminal" || job.info.status !== "running") return [{ kind: "absent" }, jobs]
        // Sequence zero arms before any extension. An extension that arrives first waits
        // on the same arm attempt rather than reserving ahead of it.
        if (job.state !== "armed") return [{ kind: "wait", arm: job.arm }, jobs]
        return [
          {
            kind: "reserved",
            previous: job.tail,
            scope: job.scope,
            tail,
            token: job.token,
            sequence: job.next,
          },
          new Map(jobs).set(id, { ...job, pending: job.pending + 1, next: job.next + 1, tail }),
        ]
      })
    })

    const extendExact: Interface["extendExact"] = Effect.fn("BackgroundJob.extendExact")(function* (input) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const first = yield* reserve(input.lifetime.id, input.lifetime.token)
          const result =
            first.kind === "wait"
              ? // Interruptible for the same reason as the joined start above.
                yield* restore(Deferred.await(first.arm)).pipe(
                  Effect.andThen(reserve(input.lifetime.id, input.lifetime.token)),
                )
              : first
          if (result.kind !== "reserved") return { extended: false as const }

          const request: BindRequest = {
            lifetime: input.lifetime,
            sequence: result.sequence,
            admission: input.admission,
          }
          const accepted = yield* Effect.gen(function* () {
            const decision = yield* restore(binder.bind(request))
            if (decision.kind !== "arm_allowed") return undefined
            const claimed = yield* decision.permit.claim
            if (!claimed) return undefined
            return yield* SynchronizedRef.modify(
              state.jobs,
              (jobs): readonly [InvocationHandle | undefined, Map<string, Active>] => {
                const job = jobs.get(input.lifetime.id)
                if (!job || job.token !== input.lifetime.token) return [undefined, jobs]
                if (job.state !== "armed" || job.info.status !== "running") return [undefined, jobs]
                if (job.accepted.has(result.sequence) || result.sequence >= job.next) return [undefined, jobs]
                const next: Active = { ...job, accepted: new Set([...job.accepted, result.sequence]) }
                const handle = mint(job.ledger, result.sequence)
                return [handle, new Map(jobs).set(input.lifetime.id, next)]
              },
            )
          }).pipe(
            Effect.onExit((exit) =>
              Exit.isSuccess(exit) && exit.value !== undefined
                ? Effect.void
                : unreserve(input.lifetime.id, result.token, result.tail).pipe(Effect.ignore),
            ),
          )

          if (!accepted) return { extended: false as const }

          yield* fork(
            result.scope,
            input.lifetime.id,
            result.token,
            result.sequence,
            Deferred.await(result.previous).pipe(Effect.andThen(restore(input.run))),
            result.tail,
          )
          return { extended: true as const, sequence: result.sequence, handle: accepted }
        }),
      )
    })

    const extendWithHandle: Interface["extendWithHandle"] = Effect.fn("BackgroundJob.extendWithHandle")(
      function* (input) {
        const jobs = yield* SynchronizedRef.get(state.jobs)
        const job = jobs.get(input.id)
        if (!job) return undefined
        const result = yield* extendExact({
          lifetime: { id: input.id, token: job.token },
          run: input.run,
          admission: input.admission,
        })
        return result.extended ? result.handle : undefined
      },
    )

    const extend: Interface["extend"] = Effect.fn("BackgroundJob.extend")(function* (input) {
      return (yield* extendWithHandle(input)) !== undefined
    })

    const waitOn = Effect.fn("BackgroundJob.waitOn")(function* (job: Active | undefined, timeout: number | undefined) {
      if (!job) return { timedOut: false }
      if (timeout === undefined) return { info: yield* Deferred.await(job.done), timedOut: false }
      if (yield* Deferred.isDone(job.done)) return { info: yield* Deferred.await(job.done), timedOut: false }
      if (timeout <= 0) return { info: snapshot(job), timedOut: true }
      const info = yield* Deferred.await(job.done).pipe(Effect.timeoutOption(timeout))
      if (info._tag === "Some") return { info: info.value, timedOut: false }
      return { info: snapshot(job), timedOut: true }
    })

    const wait: Interface["wait"] = Effect.fn("BackgroundJob.wait")(function* (input) {
      return yield* waitOn((yield* SynchronizedRef.get(state.jobs)).get(input.id), input.timeout)
    })

    const waitExact: Interface["waitExact"] = Effect.fn("BackgroundJob.waitExact")(function* (input) {
      return yield* waitOn(exact(yield* SynchronizedRef.get(state.jobs), input.lifetime), input.timeout)
    })

    const waitHandle: Interface["waitHandle"] = Effect.fn("BackgroundJob.waitHandle")(function* (input) {
      const binding = bindings.get(input.handle)
      if (!binding) return { timedOut: false }
      const ledger = binding.ledger
      if (input.timeout === undefined) return { info: yield* Deferred.await(ledger.done), timedOut: false }
      if (yield* Deferred.isDone(ledger.done)) return { info: yield* Deferred.await(ledger.done), timedOut: false }
      if (input.timeout <= 0) return { info: { ...ledger.info }, timedOut: true }
      const info = yield* Deferred.await(ledger.done).pipe(Effect.timeoutOption(input.timeout))
      if (info._tag === "Some") return { info: info.value, timedOut: false }
      return { info: { ...ledger.info }, timedOut: true }
    })

    const waitForPromotion: Interface["waitForPromotion"] = Effect.fn("BackgroundJob.waitForPromotion")(function* (id) {
      const job = (yield* SynchronizedRef.get(state.jobs)).get(id)
      if (!job || job.info.status !== "running") return yield* Effect.never
      if (job.info.metadata?.background === true) return snapshot(job)
      return yield* Deferred.await(job.promoted)
    })

    /** A stale exact lifetime returns absent because it can never be promoted or attach to a replacement. */
    const waitForPromotionExact: Interface["waitForPromotionExact"] = Effect.fn("BackgroundJob.waitForPromotionExact")(
      function* (lifetime) {
        const job = exact(yield* SynchronizedRef.get(state.jobs), lifetime)
        if (!job || job.info.status !== "running") return undefined
        if (job.info.metadata?.background === true) return snapshot(job)
        return yield* Deferred.await(job.promoted)
      },
    )

    const promoteOn = Effect.fn("BackgroundJob.promoteOn")(function* (id: string, token: object | undefined) {
      const result = yield* SynchronizedRef.modifyEffect(
        state.jobs,
        Effect.fnUntraced(function* (jobs) {
          const job = jobs.get(id)
          if (!job || job.info.status !== "running") return [{}, jobs] as readonly [PromoteResult, Map<string, Active>]
          // Identity is validated inside the atomic modification, before the stored
          // callback is extracted - so a stale handle can never run a replacement's
          // `onPromote`, which carries attachment ownership.
          if (token !== undefined && job.token !== token)
            return [{}, jobs] as readonly [PromoteResult, Map<string, Active>]
          if (job.info.metadata?.background === true)
            return [{ info: snapshot(job) }, jobs] as readonly [PromoteResult, Map<string, Active>]
          const next = {
            ...job,
            onPromote: undefined,
            info: {
              ...job.info,
              metadata: { ...job.info.metadata, background: true },
            },
          }
          updateLedger(job, next)
          return [
            { info: snapshot(next), onPromote: job.onPromote, promoted: job.promoted },
            new Map(jobs).set(id, next),
          ] as readonly [PromoteResult, Map<string, Active>]
        }),
      )
      if (result.info && result.promoted) yield* Deferred.succeed(result.promoted, result.info).pipe(Effect.ignore)
      if (result.onPromote) yield* result.onPromote.pipe(Effect.ignore)
      return result.info
    })

    const promote: Interface["promote"] = Effect.fn("BackgroundJob.promote")(function* (id) {
      return yield* promoteOn(id, undefined)
    })

    const promoteExact: Interface["promoteExact"] = Effect.fn("BackgroundJob.promoteExact")(function* (lifetime) {
      return yield* promoteOn(lifetime.id, lifetime.token)
    })

    const cancelOn = Effect.fn("BackgroundJob.cancelOn")(function* (id: string, token: object | undefined) {
      const completed_at = yield* Clock.currentTimeMillis
      const result = yield* SynchronizedRef.modify(state.jobs, (jobs): readonly [FinishResult, Map<string, Active>] => {
        const job = jobs.get(id)
        if (!job) return [{}, jobs]
        if (token !== undefined && job.token !== token) return [{}, jobs]
        if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
        const next: Active = {
          ...job,
          onPromote: undefined,
          state: "terminal",
          pending: 0,
          info: {
            ...job.info,
            status: "cancelled" as const,
            completed_at,
            ...(job.output ? { output: job.output.text } : {}),
          },
        }
        updateLedger(job, next)
        return [
          {
            info: snapshot(next),
            done: job.done,
            scope: job.scope,
            arm: job.arm,
            terminal: { lifetime: { id, token: job.token }, winner: "cancelled" },
          },
          new Map(jobs).set(id, next),
        ]
      })
      if (result.terminal) yield* binder.terminal(result.terminal)
      if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
      // Cancellation before arm must settle the shared attempt, or joined starts and
      // queued extensions wait on an attempt that will never complete.
      if (result.info && result.arm) yield* Deferred.succeed(result.arm, { info: result.info }).pipe(Effect.ignore)
      if (result.scope) yield* Scope.close(result.scope, Exit.void)
      return result.info
    })

    const cancel: Interface["cancel"] = Effect.fn("BackgroundJob.cancel")(function* (id) {
      return yield* cancelOn(id, undefined)
    })

    const cancelExact: Interface["cancelExact"] = Effect.fn("BackgroundJob.cancelExact")(function* (lifetime) {
      return yield* cancelOn(lifetime.id, lifetime.token)
    })

    const observe: Interface["observe"] = Effect.fn("BackgroundJob.observe")(function* (invocation) {
      const job = exact(yield* SynchronizedRef.get(state.jobs), invocation.lifetime)
      if (!job) return undefined
      return {
        state: job.state,
        accepted: job.accepted.has(invocation.sequence),
        status: job.info.status,
        ...(job.output && job.output.sequence === invocation.sequence ? { output: job.output.text } : {}),
      }
    })

    const observeHandle: Interface["observeHandle"] = Effect.fn("BackgroundJob.observeHandle")(function* (handle) {
      const binding = bindings.get(handle)
      if (!binding) return undefined
      const ledger = binding.ledger
      return {
        state: ledger.state,
        status: ledger.info.status,
        ...(ledger.output?.sequence === binding.sequence ? { output: ledger.output.text } : {}),
        invocations: new Set(ledger.handles.values()),
      }
    })

    return Service.of({
      list,
      get,
      start,
      extend,
      extendWithHandle,
      wait,
      waitForPromotion,
      promote,
      cancel,
      startExact,
      listExact,
      getExact,
      extendExact,
      waitExact,
      waitHandle,
      waitForPromotionExact,
      promoteExact,
      cancelExact,
      observe,
      observeHandle,
    })
  })

export const make = makeWith(permissiveBinder)

export const layer = Layer.effect(Service, make)

export const layerWith = (binder: Binder) => Layer.effect(Service, makeWith(binder))

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
