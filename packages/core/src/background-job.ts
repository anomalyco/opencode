export * as BackgroundJob from "./background-job"

import { Cause, Clock, Context, Deferred, Effect, Exit, Layer, Ref, Scope, SynchronizedRef } from "effect"
import { Identifier } from "./id/id"
import { makeGlobalNode } from "./effect/app-node"

export type Status = "running" | "completed" | "error" | "cancelled"

/**
 * One detected answer's payload, opaque to this registry.
 *
 * It is whatever the run detected when its prompt resolved. The registry never inspects it:
 * filing is guarded on the position alone, and every rendering decision belongs to the delivery
 * surface that consumes the answer. Prescribing a shape here would either file a rendered form —
 * contradicting delivery-time formatting — or strip what the consumer needs in order to render,
 * so the execution layer that supplies the run effect owns the representation.
 */
export type DetectedAnswer = unknown

/**
 * What a run hands back when it produced an answer: the position's identity — the run's final
 * assistant message id — plus the opaque payload. The position is the only filing guard.
 *
 * `at` is that message's creation time. The ordering key is `(at, position)` rather than the id
 * alone because message ids carry a time component that wraps, so their lexical order is not
 * chronological across a wrap boundary.
 */
export type Detected = { readonly position: string; readonly at: number; readonly detected: DetectedAnswer }

/**
 * A run that produced no answer may still carry one notice line back. Riding the run's own return
 * keeps the note scoped to its lifetime exactly as a filing is, so it can never reach another
 * lifetime registered under the same public id.
 */
export type SequenceNote = { readonly note: string }

/** What a run returns: a detected answer, a notice, or nothing — never a rendered string. */
export type SequenceOutcome = Detected | SequenceNote | undefined

/** One filed answer at a position. */
export type Answer = { readonly index: number; readonly detected: DetectedAnswer; readonly notes: readonly string[] }

export type Info = {
  id: string
  type: string
  title?: string
  status: Status
  started_at: number
  completed_at?: number
  /**
   * On an inline success terminal only: the first filed answer in position order, so a caller
   * blocked on this job receives the answer its own prompt produced. Opaque here; the
   * synchronous delivery surface renders it.
   *
   * Unset on observer-owned success terminals, whose answers were delivered per position and
   * released as they were observed — retaining a payload past that release would contradict the
   * release rule — and unset on error and cancellation terminals, whose filed answers stay
   * retained for later retrieval instead.
   */
  output?: DetectedAnswer
  error?: string
  /** Undelivered notice lines, drained at terminalization. */
  notes?: readonly string[]
  metadata?: Record<string, unknown>
}

/**
 * Pure answer-log transitions, factored out of the registry so ordering is testable without
 * constructing the service.
 *
 * The log is conversation-ordered: entries insert by `(at, position)` — the run's final assistant
 * message creation time, with the message id breaking ties — because message ids wrap and cannot
 * serve as chronology alone. Log order is therefore `(at, position)` by construction. Filing-ARRIVAL
 * order is in-order too, but for a reason outside this module: runs of one child session are
 * runner-serialized and a run's detect-to-file span contains no await, so an earlier position
 * cannot still be unfiled when a later one arrives.
 *
 * `baseIndex` plus dense `entries`: log index i is `entries[i - baseIndex]`, and observation is
 * the only thing that releases an entry.
 */
export namespace AnswerLog {
  export type Key = { readonly position: string; readonly at: number }
  export type Entry = { readonly position: string; readonly at: number; readonly answer: Answer }
  export type State = { readonly baseIndex: number; readonly entries: readonly Entry[] }

  export type Action =
    | { readonly _tag: "Observe"; readonly after: number }
    | {
        readonly _tag: "Publish"
        readonly position: string
        readonly at: number
        readonly detected: DetectedAnswer
        readonly notes: readonly string[]
      }

  export type Result =
    | { readonly _tag: "answer"; readonly answer: Answer; readonly state: State }
    | { readonly _tag: "miss"; readonly state: State }
    | { readonly _tag: "published"; readonly index: number; readonly state: State }

  export const empty: State = { baseIndex: 0, entries: [] }

  /** Chronology first; position breaks ties. Message-id order wraps, so `at` has to lead. */
  export const compare = (a: Key, b: Key): number =>
    a.at - b.at || (a.position < b.position ? -1 : a.position > b.position ? 1 : 0)

  export const transition = (state: State, action: Action): Result => {
    if (action._tag === "Observe") {
      const clamped = Math.max(action.after, state.baseIndex)
      const offset = clamped - state.baseIndex
      if (offset < state.entries.length) {
        const entry = state.entries[offset]
        // Returning answer N advances baseIndex to N+1 — the only release. Entries at or below the
        // observed offset leave the queue.
        return {
          _tag: "answer",
          answer: entry.answer,
          state: { baseIndex: clamped + 1, entries: state.entries.slice(offset + 1) },
        }
      }
      return { _tag: "miss", state }
    }
    // Sorted insert by (at, position) among retained entries. A filing whose key precedes the
    // already-delivered region delivers next rather than never.
    const key: Key = { position: action.position, at: action.at }
    const insertAt = state.entries.findIndex((entry) => compare(key, { position: entry.position, at: entry.at }) < 0)
    const at = insertAt === -1 ? state.entries.length : insertAt
    const entries = [
      ...state.entries.slice(0, at),
      {
        position: action.position,
        at: action.at,
        answer: { index: state.baseIndex + at, detected: action.detected, notes: action.notes },
      },
      ...state.entries.slice(at).map((entry, i) => ({
        position: entry.position,
        at: entry.at,
        answer: { ...entry.answer, index: state.baseIndex + at + i + 1 },
      })),
    ]
    return { _tag: "published", index: state.baseIndex + at, state: { baseIndex: state.baseIndex, entries } }
  }
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
 * What the binder is asked about: one invocation coordinate, plus the admission the
 * caller holds for it.
 *
 * Deliberately NOT `Invocation`. That type is the observation coordinate and is
 * handed to callers reading per-sequence state; admission is a property of the request to
 * arm, not of the coordinate, and folding it in would put lease identity into every
 * accounting read.
 *
 * `admission` is optional HERE and required on every input that reaches here, and those are
 * not in tension - they guard different things. `StartInput`, `ExtendInput`, and
 * `ExtendExactInput` all require it, so a CALLER cannot omit one: that is a compile error,
 * which is the enforcement. This type is the other side, the contract between two packages
 * that version independently - core produces the request, the binder consumes it - and the
 * binder must not assume its producer was well-behaved.
 *
 * So absence still means "none was supplied", NEVER "permitted". A real binder must decide
 * what to do about that; keeping the field optional is what keeps that decision reachable,
 * testable, and falsifiable rather than a branch the type system has quietly deleted.
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

/**
 * The single promotion handoff record. Only a promotion's notifications can outlive their
 * publisher, and promotion happens at most once, so there is exactly one record per lifetime with
 * lifecycle queued -> claimed -> drained.
 *
 * The claim is a lock-guarded compare-and-set: whoever wins drains the replaced gate, `promoted`
 * and `onPromote`; a terminal path that loses awaits `drained` before completing `done`. Promotion
 * and terminalization are two separate registry modifications, and this record is what bridges a
 * racing terminal back to the notifications a committed promotion owes.
 */
type Handoff = {
  state: "queued" | "claimed"
  readonly oldGate?: Deferred.Deferred<void>
  readonly promoted: Deferred.Deferred<Info>
  readonly onPromote?: Effect.Effect<void>
  readonly info: Info
  readonly drained: Deferred.Deferred<void>
}

/** A filed position held in (at, position) order while the lifetime is still foreground. */
type Buffered = {
  readonly position: string
  readonly at: number
  readonly detected: DetectedAnswer
  readonly notes: readonly string[]
  /**
   * Captured when this answer was filed: further work was still registered at that moment. If the
   * lifetime later promotes, the published answer carries the outstanding-work notice on this flag
   * rather than on the pending count at publish time, so the notice stays a fact about when the
   * answer completed instead of misattributing work registered afterwards.
   */
  readonly outstandingAtCompletion: boolean
}

type LifetimeLedger = {
  readonly lifetime: Lifetime
  readonly done: Deferred.Deferred<Info>
  readonly handles: Map<number, InvocationHandle>
  state: LifetimeState
  info: Info
  /**
   * Answer state lives on the ledger rather than on the registry entry, so reads keyed by
   * invocation handle survive replacement of the public id. All mutation happens under the
   * registry lock.
   */
  log: AnswerLog.State
  /** Position identities already filed — the run-final assistant message ids. */
  readonly filed: Set<string>
  buffered: Buffered[]
  /** Replaced on each log append; the old one is completed after the lock by its publisher. */
  gate: Deferred.Deferred<void>
  /** Undelivered notice lines, drained into the next published answer or into the terminal Info. */
  notes: string[]
  /** Caller-supplied outstanding-work notice text, attached when an answer completes with work still registered. */
  readonly outstanding?: { readonly observer: string; readonly inline: string }
  handoff?: Handoff
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
  /** A log append's replaced gate, completed after the lock by its publisher. */
  gate?: Deferred.Deferred<void>
  /** A committed promotion's handoff, claimed or awaited before `done` completes. */
  handoff?: Handoff
}

type PromoteResult = {
  info?: Info
  handoff?: Handoff
}

type StartResult =
  | { kind: "adopted"; info: Info; token: object; handle?: InvocationHandle }
  | { kind: "joined"; arm: Deferred.Deferred<ArmOutcome> }
  | { kind: "publishing"; done: Deferred.Deferred<Info> }
  | {
      kind: "registrar"
      info: Info
      scope: Scope.Closeable
      token: object
      arm: Deferred.Deferred<ArmOutcome>
      ledger: LifetimeLedger
    }

type ReserveResult =
  | { kind: "absent" }
  | { kind: "wait"; arm: Deferred.Deferred<ArmOutcome> }
  | {
      kind: "reserved"
      scope: Scope.Closeable
      token: object
      sequence: number
      ledger: LifetimeLedger
    }

/**
 * `state` is separate from public status: registered and binding lifetimes already report running,
 * so status alone cannot say whether an invocation has armed.
 */
export type ExactEntry = { readonly lifetime: Lifetime; readonly info: Info; readonly state: LifetimeState }

/**
 * Per-sequence output observation is deliberately absent: output belongs to a run, so "did my
 * sequence produce the current output" has no referent once one lifetime can hold several answers.
 */
export type Observation = {
  readonly state: LifetimeState
  readonly accepted: boolean
  readonly status: Status
}

/** `bindings.get(handle)` is the acceptance check; a second always-true `accepted` field is forbidden. */
export type HandleObservation = Omit<Observation, "accepted"> & {
  /** Unordered accepted invocation identities for this lifetime; final when terminal. */
  readonly invocations: ReadonlySet<InvocationHandle>
}

/**
 * Pure settle-admissibility decision, extracted so each arm is deterministically testable without
 * scheduler timing. A run's settle may act only on the lifetime that constructed it: the same
 * registry occupant, the same construction token, still running.
 *
 * `foreign_token` is the replaced-lifetime arm — the filing or failure is dropped without touching
 * the current occupant. `not_running` is the terminalization race — nothing files.
 */
export type SettleAdmissibility = "admit" | "foreign_token" | "not_running"
export const settleAdmissibility = (
  current: { readonly token: object; readonly status: Status },
  token: object,
): SettleAdmissibility => {
  if (current.token !== token) return "foreign_token"
  if (current.status !== "running") return "not_running"
  return "admit"
}

export type StartInput = {
  id?: string
  type: string
  title?: string
  metadata?: Record<string, unknown>
  onPromote?: Effect.Effect<void>
  /**
   * Outstanding-work notice text for this lifetime, supplied by the caller so the registry stays
   * free of presentation. `observer` rides a published answer when work was still registered at
   * that answer's completion; `inline` rides the terminal notes when a success disposition retains
   * a second filed answer that the blocked caller will not receive.
   */
  outstanding?: { readonly observer: string; readonly inline: string }
  run: Effect.Effect<SequenceOutcome, unknown>
  /**
   * The execution admission this start rests on, relayed to the binder for sequence zero.
   *
   * REQUIRED, and that is the enforcement rather than a convention: a start with no admission is
   * a compile error instead of a silent runtime pass. An optional field here would degrade toward
   * PERMITTING MORE - a caller that simply omitted it would run unfenced with no type error and no
   * runtime signal - and silent composition failure is this codebase's recurring hazard, not a
   * hypothetical one. The ID-based compatibility exemption covers
   * `list`/`get`/`promote`/`waitForPromotion`; it does not cover `start` or `extend`, so the
   * id-keyed surface carries an admission too.
   */
  admission: Admission
}

export type StartExactResult = ArmOutcome

export type ExtendInput = {
  id: string
  run: Effect.Effect<SequenceOutcome, unknown>
  /**
   * Relayed to the binder for the reserved sequence. REQUIRED for the reason `StartInput.admission`
   * gives, and with one addition: an extension is a SEPARATE admission, never a reuse of the one
   * that armed sequence zero. Consuming that permit bound the lease to that invocation, and a bound
   * lease is no longer `reserved`, so `validLease` refuses it for anything else.
   */
  admission: Admission
}

export type ExtendExactInput = {
  lifetime: Lifetime
  run: Effect.Effect<SequenceOutcome, unknown>
  /** Relayed to the binder for the reserved sequence. REQUIRED - see `ExtendInput.admission`. */
  admission: Admission
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

/** Observation input for the answer gate. */
export type WaitAnswerInput = { readonly handle: InvocationHandle; readonly after: number }

/**
 * The retained answer at `after`, which advances the log's base index, or the terminal `Info` when
 * the lifetime is terminal with no retained answer at or above `after`. Empty when the handle is
 * unknown.
 */
export type WaitAnswerResult = { readonly answer?: Answer; readonly info?: Info }

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
  /**
   * Returns the retained answer at `after` — advancing the log's base index to `after + 1` — else
   * the terminal `Info` once terminal, else waits on the current gate or on completion and retries
   * in full. Keyed by handle so reads survive replacement of the public id; an `after` below the
   * base index clamps up to it.
   */
  readonly waitAnswer: (input: WaitAnswerInput) => Effect.Effect<WaitAnswerResult>
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
    }

    const claimHandoff = (handoff: Handoff) =>
      SynchronizedRef.modify(state.jobs, (jobs): readonly [boolean, Map<string, Active>] => {
        if (handoff.state === "queued") {
          handoff.state = "claimed"
          return [true, jobs]
        }
        return [false, jobs]
      })

    /**
     * Exactly-once drain of a committed promotion's notifications. The claim winner completes the
     * replaced gate and `promoted`, forks `onPromote` into the registry's own long-lived scope, and
     * marks the record drained. A terminal path that loses the claim awaits that mark before
     * completing `done`, so a committed publication always reaches its notifications.
     */
    const drainHandoff = Effect.fn("BackgroundJob.drainHandoff")(function* (handoff: Handoff) {
      const claimed = yield* claimHandoff(handoff)
      if (!claimed) return yield* Deferred.await(handoff.drained)
      if (handoff.oldGate) yield* Deferred.succeed(handoff.oldGate, undefined).pipe(Effect.ignore)
      yield* Deferred.succeed(handoff.promoted, handoff.info).pipe(Effect.ignore)
      if (handoff.onPromote) {
        yield* handoff.onPromote.pipe(Effect.ignore, Effect.forkIn(state.scope, { startImmediately: true }))
      }
      yield* Deferred.succeed(handoff.drained, undefined).pipe(Effect.ignore)
    })

    const settle = Effect.fn("BackgroundJob.settle")(
      function* (id: string, token: object, exit: Exit.Exit<SequenceOutcome, unknown>) {
        const completed_at = yield* Clock.currentTimeMillis
        // Publishing swaps the ledger gate; the fresh gate is made before the lock so the committed
        // modification stays pure.
        const freshGate = yield* Deferred.make<void>()
        const result = yield* SynchronizedRef.modify(
          state.jobs,
          (jobs): readonly [FinishResult, Map<string, Active>] => {
            const job = jobs.get(id)
            if (!job) return [{}, jobs]
            const admissibility = settleAdmissibility({ token: job.token, status: job.info.status }, token)
            if (admissibility === "foreign_token") return [{}, jobs]
            if (admissibility === "not_running") {
              // A late settle against a terminalized lifetime files nothing.
              return [{ info: snapshot(job) }, jobs]
            }
            const ledger = job.ledger
            const pending = job.pending - 1
            // The gate swaps on every settle so parked observers re-evaluate the log.
            const gate: Deferred.Deferred<void> | undefined = ledger.gate
            ledger.gate = freshGate

            // Filing: the fork files the run's outcome under its construction token, so a filing can
            // never reach another lifetime. Exactly one membership check, on the position's identity;
            // an already-filed position is a no-op. A notice rides the same scoped channel.
            const filing = Exit.isSuccess(exit) ? exit.value : undefined
            if (filing !== undefined) {
              if ("note" in filing) {
                ledger.notes.push(filing.note)
              } else if (!ledger.filed.has(filing.position)) {
                ledger.filed.add(filing.position)
                if (job.info.metadata?.background === true) {
                  // Observed lifetime: the filed position enters the log immediately. Queued notes
                  // drain into the appended answer, and work still registered at this answer's
                  // completion adds the outstanding-work notice.
                  const notes = ledger.notes.splice(0)
                  if (pending > 0 && ledger.outstanding) notes.push(ledger.outstanding.observer)
                  const published = AnswerLog.transition(ledger.log, {
                    _tag: "Publish",
                    position: filing.position,
                    at: filing.at,
                    detected: filing.detected,
                    notes,
                  })
                  if (published._tag === "published") ledger.log = published.state
                } else {
                  // Foreground: buffer in (at, position) order awaiting disposition. The outstanding
                  // flag is captured now, because the notice is a fact about this answer's
                  // completion rather than about the moment it is later published.
                  const key = { position: filing.position, at: filing.at }
                  const insertAt = ledger.buffered.findIndex(
                    (entry) => AnswerLog.compare(key, { position: entry.position, at: entry.at }) < 0,
                  )
                  const at = insertAt === -1 ? ledger.buffered.length : insertAt
                  ledger.buffered = [
                    ...ledger.buffered.slice(0, at),
                    {
                      position: filing.position,
                      at: filing.at,
                      detected: filing.detected,
                      notes: [],
                      outstandingAtCompletion: pending > 0,
                    },
                    ...ledger.buffered.slice(at),
                  ]
                }
              }
            }

            if (Exit.isSuccess(exit) && pending > 0) {
              const next = { ...job, pending }
              updateLedger(job, next)
              return [{ ...(gate ? { gate } : {}) }, new Map(jobs).set(id, next)]
            }
            const status: Exclude<Status, "running"> = Exit.isSuccess(exit)
              ? "completed"
              : Cause.hasInterruptsOnly(exit.cause)
                ? "cancelled"
                : "error"
            // Disposition, per status. Success carries the first filed answer inline — the answer a
            // blocked caller's own prompt produced. That slot is inline-only: an observer-owned
            // success terminal carries no output, because its answers were delivered per position
            // and released as they were observed. A retained second answer adds the inline
            // outstanding notice. Error and cancellation carry no answer payload and leave filed
            // answers retained rather than pushing them.
            const first = ledger.buffered[0]
            const retainsSecond = status === "completed" && ledger.buffered.length > 1
            if (retainsSecond && ledger.outstanding) ledger.notes.push(ledger.outstanding.inline)
            const notes = ledger.notes.splice(0)
            // Filed identities are retained only until every accepted run settles, and filings are
            // impossible past the status guard, so the identity set clears here.
            ledger.filed.clear()
            const next = {
              ...job,
              onPromote: undefined,
              state: "terminal" as const,
              pending: 0,
              info: {
                ...job.info,
                status,
                completed_at,
                ...(status === "completed" && first !== undefined ? { output: first.detected } : {}),
                ...(Exit.isFailure(exit) ? { error: errorText(Cause.squash(exit.cause)) } : {}),
                ...(notes.length ? { notes } : {}),
              },
            }
            // The inline-delivered answer releases; undelivered answers never do.
            if (status === "completed" && ledger.buffered.length > 0) ledger.buffered = ledger.buffered.slice(1)
            updateLedger(job, next)
            return [
              {
                info: snapshot(next),
                done: job.done,
                scope: job.scope,
                terminal: { lifetime: { id, token }, winner: status },
                ...(gate ? { gate } : {}),
                ...(ledger.handoff ? { handoff: ledger.handoff } : {}),
              },
              new Map(jobs).set(id, next),
            ]
          },
        )
        // The registry lock is released, the winner is committed, and the publication
        // barrier is still closed. Every waiter and same-ID replacement joins `done`, so
        // none can outrun the admission authority's exact-token terminal transition.
        if (result.gate) yield* Deferred.succeed(result.gate, undefined).pipe(Effect.ignore)
        if (result.terminal) yield* binder.terminal(result.terminal)
        // A committed promotion's notifications precede `done`.
        if (result.handoff) yield* drainHandoff(result.handoff)
        if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
        if (result.scope) {
          yield* Scope.close(result.scope, Exit.void).pipe(Effect.forkIn(state.scope, { startImmediately: true }))
        }
        return result.info
      },
      // The window between committing the winner and delivering its notifications is uninterruptible.
      Effect.uninterruptible,
    )

    const fork = Effect.fn("BackgroundJob.fork")(function* (
      scope: Scope.Scope,
      id: string,
      token: object,
      run: Effect.Effect<SequenceOutcome, unknown>,
    ) {
      return yield* run.pipe(
        Effect.matchCauseEffect({
          onSuccess: (outcome) => settle(id, token, Exit.succeed(outcome)),
          onFailure: (cause) => settle(id, token, Exit.failCause(cause)),
        }),
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
            ...(job.ledger.handoff ? { handoff: job.ledger.handoff } : {}),
          },
          new Map(jobs).set(id, next),
        ]
      })
      if (result.terminal) yield* binder.terminal(result.terminal)
      if (result.handoff) yield* drainHandoff(result.handoff)
      if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
      if (result.info && result.arm) yield* Deferred.succeed(result.arm, { info: result.info }).pipe(Effect.ignore)
      if (result.scope) yield* Scope.close(result.scope, Exit.void).pipe(Effect.ignore)
      return result.info
    }, Effect.uninterruptible)

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
          const gate = yield* Deferred.make<void>()
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
                log: AnswerLog.empty,
                filed: new Set(),
                buffered: [],
                gate,
                notes: [],
                ...(input.outstanding ? { outstanding: input.outstanding } : {}),
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
                promoted,
                onPromote: input.onPromote,
                ledger,
              }
              return [
                { kind: "registrar", info: snapshot(job), scope, token, arm, ledger },
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
          // A job created already observed completes `promoted` here, after the registry lock and
          // under this mask. That is a mode rather than a transition — no promotion occurs and the
          // promotion path is never on its route — so nothing else would ever complete it.
          if (input.metadata?.background === true) {
            yield* Deferred.succeed(promoted, registration.info).pipe(Effect.ignore)
          }
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

          yield* fork(registration.scope, id, registration.token, restore(input.run))
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
            scope: job.scope,
            token: job.token,
            sequence: job.next,
            ledger: job.ledger,
          },
          new Map(jobs).set(id, { ...job, pending: job.pending + 1, next: job.next + 1 }),
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
                : // This reserved coordinate lost admission, so nothing will ever run for it.
                  // Returning `pending` alone left the lifetime `armed`/`running` at `pending: 0`
                  // with nothing remaining to settle it whenever the owner sequence had already
                  // settled successfully — a permanent strand. It hung any blocked synchronous
                  // caller (`done` resolves only at disposition), discarded the owner's completed
                  // answer (moving it into the terminal Info is itself a disposition step), and
                  // withheld the terminal that releases a child Task session's attachment scope.
                  // The refusal therefore settles as a sequence with NO outcome: `undefined` is a
                  // legal SequenceOutcome, so nothing files, an already-successful owner answer
                  // still disposes through its inline slot, and the status is `completed` — the
                  // FOLLOW-UP was refused and its own caller learns that from its own result,
                  // while the run's own work demonstrably succeeded; marking the job `error` would
                  // emit an error envelope for a lifetime that did not fail.
                  // `settleAdmissibility` covers the hazards for free: a replaced lifetime is
                  // `foreign_token`, an already-terminal one `not_running`, and a concurrent second
                  // refusal `not_running` — each a no-op. With other sequences still registered,
                  // settle's `pending > 0` branch keeps the lifetime alive exactly as the bare
                  // decrement did.
                  settle(input.lifetime.id, result.token, Exit.succeed(undefined)).pipe(Effect.ignore),
            ),
          )

          if (!accepted) return { extended: false as const }

          // An accepted supplemental run registers and runs without waiting for any previous run's
          // tail: the serial hold is gone, so several runs on one lifetime can be in flight at once
          // and their answers are ordered by position at delivery rather than by execution.
          yield* fork(result.scope, input.lifetime.id, result.token, restore(input.run))
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
      // No fast return for an already-observed job: `promoted` now completes on every route into
      // that mode — at registration when the job is born observed, at the transition otherwise — so
      // awaiting it is always correct and yields the promotion-time Info rather than a call-time
      // snapshot.
      return yield* Deferred.await(job.promoted)
    })

    /** A stale exact lifetime returns absent because it can never be promoted or attach to a replacement. */
    const waitForPromotionExact: Interface["waitForPromotionExact"] = Effect.fn("BackgroundJob.waitForPromotionExact")(
      function* (lifetime) {
        const job = exact(yield* SynchronizedRef.get(state.jobs), lifetime)
        if (!job || job.info.status !== "running") return undefined
        // Fast return removed - see `waitForPromotion`.
        return yield* Deferred.await(job.promoted)
      },
    )

    const promoteOn = Effect.fn("BackgroundJob.promoteOn")(
      function* (id: string, token: object | undefined) {
        // Publishing swaps the ledger gate; fresh Deferreds are made before the lock.
        const freshGate = yield* Deferred.make<void>()
        const drained = yield* Deferred.make<void>()
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
            // The one-way transition: commit the observed mode, publish buffered positions in
            // order, swap the gate, and capture `promoted` and `onPromote` into the single handoff
            // record before the spread below nulls them.
            const ledger = job.ledger
            const published = ledger.buffered.length > 0
            for (const entry of ledger.buffered) {
              const drainedNotes =
                ledger.notes.length > 0 ? [...ledger.notes.splice(0), ...entry.notes] : [...entry.notes]
              // An answer that completed while further work was still registered carries the
              // outstanding-work notice when it publishes. The flag was captured at that answer's
              // completion, so the notice cannot misattribute work registered after it.
              if (entry.outstandingAtCompletion && ledger.outstanding) drainedNotes.push(ledger.outstanding.observer)
              const outcome = AnswerLog.transition(ledger.log, {
                _tag: "Publish",
                position: entry.position,
                at: entry.at,
                detected: entry.detected,
                notes: drainedNotes,
              })
              if (outcome._tag === "published") ledger.log = outcome.state
            }
            ledger.buffered = []
            const oldGate = published ? ledger.gate : undefined
            if (published) ledger.gate = freshGate
            const next = {
              ...job,
              onPromote: undefined,
              info: {
                ...job.info,
                metadata: { ...job.info.metadata, background: true },
              },
            }
            updateLedger(job, next)
            const handoff: Handoff = {
              state: "queued",
              ...(oldGate ? { oldGate } : {}),
              promoted: job.promoted,
              ...(job.onPromote ? { onPromote: job.onPromote } : {}),
              info: snapshot(next),
              drained,
            }
            ledger.handoff = handoff
            return [{ info: snapshot(next), handoff }, new Map(jobs).set(id, next)] as readonly [
              PromoteResult,
              Map<string, Active>,
            ]
          }),
        )
        // After the lock, in this same fiber and inside the uninterruptible window: the captured
        // old gate, `promoted`, and the callback's guaranteed scheduling.
        if (result.handoff) yield* drainHandoff(result.handoff)
        return result.info
      },
      Effect.uninterruptible,
    )

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
        // A cancellation terminal carries no answer payload: filed answers stay retained and remain
        // retrievable by task id. Undelivered notice lines drain into the terminal Info. Identity
        // state clears at the terminal boundary, because filings are impossible past the status
        // guard.
        const notes = job.ledger.notes.splice(0)
        job.ledger.filed.clear()
        const next: Active = {
          ...job,
          onPromote: undefined,
          state: "terminal",
          pending: 0,
          info: {
            ...job.info,
            status: "cancelled" as const,
            completed_at,
            ...(notes.length ? { notes } : {}),
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
            ...(job.ledger.handoff ? { handoff: job.ledger.handoff } : {}),
          },
          new Map(jobs).set(id, next),
        ]
      })
      if (result.terminal) yield* binder.terminal(result.terminal)
      // A committed promotion's notifications precede `done`.
      if (result.handoff) yield* drainHandoff(result.handoff)
      if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
      // Cancellation before arm must settle the shared attempt, or joined starts and
      // queued extensions wait on an attempt that will never complete.
      if (result.info && result.arm) yield* Deferred.succeed(result.arm, { info: result.info }).pipe(Effect.ignore)
      if (result.scope) yield* Scope.close(result.scope, Exit.void)
      return result.info
    }, Effect.uninterruptible)

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
      }
    })

    const observeHandle: Interface["observeHandle"] = Effect.fn("BackgroundJob.observeHandle")(function* (handle) {
      const binding = bindings.get(handle)
      if (!binding) return undefined
      const ledger = binding.ledger
      return {
        state: ledger.state,
        status: ledger.info.status,
        invocations: new Set(ledger.handles.values()),
      }
    })

    /**
     * The answer gate. Observation runs inside the registry lock without changing the jobs map, and
     * the ledger is reached by handle, so reads survive replacement of the public id. Any gate or
     * completion wake causes a full retry rather than a resumed partial read.
     */
    const waitAnswer: Interface["waitAnswer"] = Effect.fn("BackgroundJob.waitAnswer")(function* (input) {
      while (true) {
        const step = yield* SynchronizedRef.modify(
          state.jobs,
          (
            jobs,
          ): readonly [
            { answer?: Answer; info?: Info; gate?: Deferred.Deferred<void>; done?: Deferred.Deferred<Info> },
            Map<string, Active>,
          ] => {
            const binding = bindings.get(input.handle)
            if (!binding) return [{}, jobs]
            const ledger = binding.ledger
            const observed = AnswerLog.transition(ledger.log, {
              _tag: "Observe",
              after: input.after,
            })
            if (observed._tag === "answer") {
              ledger.log = observed.state
              return [{ answer: observed.answer }, jobs]
            }
            if (ledger.state === "terminal") return [{ info: { ...ledger.info } }, jobs]
            return [{ gate: ledger.gate, done: ledger.done }, jobs]
          },
        )
        if (step.answer) return { answer: step.answer }
        if (step.info) return { info: step.info }
        if (!step.gate || !step.done) return {}
        yield* Effect.raceFirst(Deferred.await(step.gate), Deferred.await(step.done).pipe(Effect.asVoid))
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
      waitAnswer,
    })
  })

export const make = makeWith(permissiveBinder)

export const layer = Layer.effect(Service, make)

export const layerWith = (binder: Binder) => Layer.effect(Service, makeWith(binder))

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
