import { Cause, Context, Deferred, Effect, Exit, Option, Scope } from "effect"
import type { SessionID } from "../schema"
import { SessionClosure } from "./coordinator"
import { SessionClosureModel as Model } from "./model"

// One opaque Effect context follows a logical admission through nested seams, avoiding duplicate
// leases without exposing authority in an HTTP schema payload.
export interface Interface {
  readonly coordinator: Model.InstanceID
  readonly session: SessionID
  readonly leases: readonly Model.LeaseID[]
  readonly kind: "pre_bind" | "continuation"
  /** Singular while each context contains one lease; merged leases would need per-lease epochs. */
  readonly epoch: bigint
  readonly origin: "external" | "internal"
  readonly retry: "initial" | "post_closure_external_retry"
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionAdmissionContext") {}

export type Input = {
  readonly session: SessionID
  readonly origin: "external" | "internal"
  readonly source: string
  /**
   * `false` forces a new decision for work that begins later inside an admitted chain. `"revalidate"`
   * reuses the lease only after an atomic current-fence check.
   */
  readonly reuseAmbient?: boolean | "revalidate"
  /** Disabled where retrying would resume a blocked tool in a branch that just closed. */
  readonly retryable?: boolean
}

const scopeID = () => Model.id("scope", `scope_${crypto.randomUUID()}`)

/** Races setup with the fence signal so a landing fence interrupts in-flight work. */
const guarded = <A, E, R>(body: Effect.Effect<A, E, R>, signal: Deferred.Deferred<void>) =>
  Effect.raceFirst(body, Deferred.await(signal).pipe(Effect.andThen(Effect.interrupt)))

export const ambient = (session: SessionID) =>
  Effect.serviceOption(Service).pipe(
    Effect.map((found) => {
      if (Option.isNone(found)) return undefined
      // A child session must acquire its own admission rather than inherit the parent's fence state.
      if (found.value.session !== session) return undefined
      return found.value
    }),
  )

type Reserved = {
  readonly type: "reserved"
  readonly lease: Model.LeaseID
  readonly context: Interface
  readonly signal: Deferred.Deferred<void>
}

/** The receiving seam must complete or suppress an adopted lease. */
type Joined = {
  readonly type: "joined"
  readonly admission: Extract<SessionClosure.Admission, { readonly type: "joined" }>
}

type Reservation = Reserved | Joined

type Retry = { readonly retry: "post_closure_external_retry"; readonly lease: Model.LeaseID }

const reserve = (
  closure: SessionClosure.Interface,
  input: ScopedInput,
  attempt?: Retry,
): Effect.Effect<Reservation, SessionClosure.AdmissionRefused> =>
  Effect.gen(function* () {
    // Create the signal before acquiring the lease so every live lease has a reachable owner.
    const signal = yield* Deferred.make<void>()
    const decision = yield* closure
      .acquire({
        session: input.session,
        origin: input.origin,
        retry: attempt?.retry ?? "initial",
        source: input.source,
        owner: { id: scopeID(), signal },
        // Reusing the adopted ID makes this a retry rather than a second reservation.
        ...(attempt ? { lease: attempt.lease } : {}),
      })
      // A misroute fails closed as a routing defect, not as a synthesized fence.
      .pipe(Effect.catchTag("SessionClosureLocationError", () => Effect.succeed(misrouted)))
    if (decision.type === "misrouted")
      return yield* new SessionClosure.AdmissionRefused({ session: input.session, reason: "wrong_instance" })
    if (decision.type === "fenced")
      return yield* new SessionClosure.AdmissionRefused({ session: input.session, reason: decision.state })
    if (decision.type === "joined") return { type: "joined" as const, admission: decision }
    return {
      type: "reserved" as const,
      lease: decision.lease,
      signal,
      context: {
        coordinator: decision.instance,
        session: input.session,
        leases: [decision.lease],
        kind: "pre_bind",
        epoch: decision.epoch,
        origin: input.origin,
        retry: attempt?.retry ?? "initial",
      },
    }
  })

/** The model permits one same-ID retry and rejects further attempts. */
const joinThenRetryOnce = (closure: SessionClosure.Interface, input: ScopedInput, joined: Joined) =>
  Effect.gen(function* () {
    yield* joined.admission.release
    const second = yield* reserve(closure, input, {
      retry: "post_closure_external_retry",
      lease: joined.admission.lease,
    }).pipe(
      // A refused retry still owns the adopted lease and must suppress it.
      Effect.tapError(() => closure.retire(joined.admission.lease, "suppressed").pipe(Effect.ignore)),
    )
    // The model currently cannot return `joined` here; handle it defensively as a settled refusal.
    if (second.type === "joined") {
      yield* closure.retire(second.admission.lease, "suppressed").pipe(Effect.ignore)
      return yield* new SessionClosure.AdmissionRefused({ session: input.session, reason: second.admission.state })
    }
    return second
  })

/** Refusal still settles a joined lease. */
const refuseJoined = (closure: SessionClosure.Interface, input: ScopedInput, joined: Joined) =>
  Effect.gen(function* () {
    yield* closure.retire(joined.admission.lease, "suppressed").pipe(Effect.ignore)
    return yield* new SessionClosure.AdmissionRefused({ session: input.session, reason: joined.admission.state })
  })

/** Revalidates against the current fence and original epoch without minting another lease. */
const revalidateAmbient = (closure: SessionClosure.Interface, input: Input, existing: Interface) =>
  Effect.gen(function* () {
    const lease = existing.leases.length === 1 ? existing.leases[0] : undefined
    if (!lease || input.origin !== "internal" || existing.origin !== "internal")
      return yield* new SessionClosure.AdmissionRefused({
        session: input.session,
        reason: "closure_unavailable",
      })
    const decision = yield* closure
      .acquire({
        session: input.session,
        origin: "internal",
        retry: "initial",
        source: input.source,
        lease,
        epoch: existing.epoch,
        revalidate: "ambient_continuation",
      })
      .pipe(Effect.catchTag("SessionClosureLocationError", () => Effect.succeed(misrouted)))
    if (decision.type === "misrouted")
      return yield* new SessionClosure.AdmissionRefused({ session: input.session, reason: "wrong_instance" })
    if (decision.type === "fenced")
      return yield* new SessionClosure.AdmissionRefused({ session: input.session, reason: decision.state })
    if (decision.type === "joined") {
      yield* closure.retire(decision.lease, "suppressed").pipe(Effect.ignore)
      return yield* new SessionClosure.AdmissionRefused({ session: input.session, reason: decision.state })
    }
    if (decision.lease === lease && decision.epoch === existing.epoch && decision.instance === existing.coordinator)
      return
    // Minting or rerouting is not reuse; settle it and fail closed.
    yield* closure.retire(decision.lease, "suppressed").pipe(Effect.ignore)
    return yield* new SessionClosure.AdmissionRefused({ session: input.session, reason: "closure_unavailable" })
  })

/**
 * Acquisition precedes executable setup and retirement is a finalizer, so interruption cannot leave
 * an unowned or unsettled lease.
 */
export const admitted = <A, E, R>(
  closure: SessionClosure.Interface,
  input: Input,
  body: (context: Interface) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | SessionClosure.AdmissionRefused, R> =>
  Effect.gen(function* () {
    const existing = input.reuseAmbient === false ? undefined : yield* ambient(input.session)
    if (existing) {
      if (input.reuseAmbient === "revalidate" && existing.kind === "continuation")
        yield* revalidateAmbient(closure, input, existing)
      return yield* body(existing)
    }
    const reservation = yield* reserve(closure, input)
    const held =
      reservation.type === "reserved"
        ? reservation
        : yield* input.retryable === false
            ? refuseJoined(closure, input, reservation)
            : joinThenRetryOnce(closure, input, reservation)
    // Keep the interruptible body inside the retirement finalizer.
    return yield* guarded(body(held.context).pipe(Effect.provideService(Service, held.context)), held.signal).pipe(
      Effect.ensuring(closure.retire(held.lease).pipe(Effect.ignore)),
    )
  })

export type ScopedInput = Omit<Input, "reuseAmbient">

/**
 * Scope-bound callers acquire a fresh lease so their finalizer owns what it settles. Executable Task
 * work runs in the job scope, so this caller needs no interrupt race.
 */
export const admitScoped = (
  closure: SessionClosure.Interface,
  input: ScopedInput,
): Effect.Effect<Interface, SessionClosure.AdmissionRefused, Scope.Scope> =>
  Effect.gen(function* () {
    // `refuseJoined` settles joined reservations; the scope finalizer must not settle them twice.
    const held = yield* Effect.acquireRelease(reserve(closure, input), (item) =>
      item.type === "reserved" ? closure.retire(item.lease).pipe(Effect.ignore) : Effect.void,
    )
    // A scope-bound admission has no body to retry, so a joined result is a settled refusal.
    if (held.type === "joined") return yield* refuseJoined(closure, input, held)
    return held.context
  })

const misrouted = { type: "misrouted" } as const

export type ContinuationInput = {
  readonly session: SessionID
  readonly caller: SessionID
  readonly target: SessionID
  readonly source: string
  readonly originEpoch?: bigint
  readonly invocation?: {
    readonly job: Model.JobID
    readonly lifetime: Model.LifetimeID
    readonly sequence: bigint
  }
}

/** Classifies orderly closure refusal without treating defects or interruption as refusal. */
export const isAdmissionRefusal = (cause: Cause.Cause<unknown>) =>
  Cause.hasFails(cause) &&
  !Cause.hasDies(cause) &&
  !Cause.hasInterrupts(cause) &&
  (Cause.squash(cause) as { readonly _tag?: string } | undefined)?._tag === "SessionClosureAdmissionRefused"

/** Maps defects to failure so observer death cannot look like successful completion. */
const dispositionOf = <A, E>(exit: Exit.Exit<A, E>): SessionClosure.LeaseDisposition => {
  const cause = Exit.isFailure(exit) ? exit.cause : undefined
  return cause === undefined
    ? "retired"
    : Exit.hasInterrupts(exit) || isAdmissionRefusal(cause)
      ? "suppressed"
      : "failed"
}

export type HeldContinuation = {
  readonly context: Interface
  /** Fork only after acquisition so the lease exists before the waiter is scheduled. */
  readonly observe: <A, E, R>(body: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

/** A fresh lease avoids inherited Effect context whose lease the parent may already have retired. */
export const acquireContinuation = (
  closure: SessionClosure.Interface,
  input: ContinuationInput,
): Effect.Effect<HeldContinuation, SessionClosure.AdmissionRefused> => {
  // Retain ownership until the handle is published so an abnormal exit can settle the lease failed.
  const ownership = { lease: undefined as Model.LeaseID | undefined }
  return Effect.gen(function* () {
    const signal = yield* Deferred.make<void>()
    const decision = yield* closure
      .acquire({
        session: input.session,
        origin: "internal",
        retry: "initial",
        source: input.source,
        owner: { id: scopeID(), signal },
        kind: "continuation",
        caller: input.caller,
        target: input.target,
        ...(input.originEpoch !== undefined ? { originEpoch: input.originEpoch } : {}),
        ...(input.invocation ? { invocation: input.invocation } : {}),
      })
      .pipe(Effect.catchTag("SessionClosureLocationError", () => Effect.succeed(misrouted)))
    if (decision.type === "misrouted")
      return yield* new SessionClosure.AdmissionRefused({ session: input.session, reason: "wrong_instance" })
    if (decision.type === "fenced")
      return yield* new SessionClosure.AdmissionRefused({ session: input.session, reason: decision.state })
    ownership.lease = decision.lease
    const context: Interface = {
      coordinator: decision.instance,
      session: input.session,
      leases: [decision.lease],
      kind: "continuation",
      epoch: decision.epoch,
      origin: "internal",
      retry: "initial",
    }
    const observe = <A, E, R>(body: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.gen(function* () {
        // Capture the exit so settlement reflects the actual outcome.
        const settled = yield* guarded(body.pipe(Effect.provideService(Service, context)), signal).pipe(Effect.exit)
        yield* closure.retire(decision.lease, dispositionOf(settled)).pipe(Effect.ignore)
        return yield* settled
      })
    return { context, observe }
  }).pipe(
    Effect.onExit((exit) => {
      const lease = ownership.lease
      if (!lease || Exit.isSuccess(exit)) return Effect.void
      return Effect.uninterruptible(
        closure.retire(lease, "failed").pipe(
          Effect.catchCause((cause) =>
            Effect.logError("continuation lease publication cleanup failed", {
              lease,
              session: input.session,
              cause: Cause.pretty(cause),
            }),
          ),
        ),
      )
    }),
  )
}

export const continuation = <A, E, R>(
  closure: SessionClosure.Interface,
  input: ContinuationInput,
  body: (context: Interface) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | SessionClosure.AdmissionRefused, R> =>
  Effect.gen(function* () {
    const held = yield* acquireContinuation(closure, input)
    return yield* held.observe(body(held.context))
  })

export * as SessionAdmission from "./admission"
