import { Context, Deferred, Effect, Exit, Layer } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { MessageID, SessionID } from "@/session/schema"
import { InstanceState } from "@/effect/instance-state"
import { AttachmentContract } from "./contract"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { SessionClosurePorts as Ports } from "@/session/closure/ports"
import type { TaskSelectedReturn, TaskTurnEvidence } from "@/session/task-return"

export type Reservation = {
  readonly scopeID: string
  readonly jobID: SessionID
  readonly token: string
  readonly fresh: boolean
}

/** Opaque proof that one exact reservation reached terminal observation. */
export type Terminal = {
  readonly scopeID: string
  readonly token: string
}

export type Claim =
  | {
      readonly owner: true
      readonly sessionID: SessionID
      readonly token: object
      readonly ready: Deferred.Deferred<boolean>
    }
  | {
      readonly owner: false
      readonly sessionID: SessionID
      readonly ready: Deferred.Deferred<boolean>
    }

export type ObserverClaim =
  | { readonly type: "owner" }
  | { readonly type: "fallback" }
  | { readonly type: "existing" }
  | {
      readonly type: "unavailable"
      readonly reason: "cancelled" | "closed" | "invalid"
    }

export interface Scope extends AttachmentContract.Scope {
  readonly sessionID: SessionID
  /**
   * Claims a message for this scope, invalidating the turn's prior evidence.
   *
   * `true` does NOT mean ownership was taken. It means the claim was not REFUSED, and covers two
   * outcomes: ownership actually taken, and the historical no-op where a scope that closed without
   * ever resolving accepts the call and does nothing. `false` is returned only when the scope had
   * already published its resolution and can no longer accept one — the admission boundary converts
   * that into the typed `SessionScopeOwnRefused`, while non-admission callers ignore it. A degraded
   * or cancelled scope that has NOT resolved still throws, which is CP-031's existing recoverable
   * admission failure and is deliberately unchanged.
   */
  readonly own: (messageID: MessageID) => Effect.Effect<boolean>
  readonly owns: (messageID: MessageID) => boolean
  readonly reserve: (jobID: SessionID) => Effect.Effect<Reservation>
  readonly reject: (reservation: Reservation) => Effect.Effect<void>
  /** Atomically classifies observer ownership without collapsing unavailable states into one boolean. */
  readonly claimObserver: (reservation: Reservation) => Effect.Effect<ObserverClaim>
  /** Moves one exact observer-owned reservation from J to U. */
  readonly terminal: (reservation: Reservation) => Effect.Effect<Terminal | undefined>
  /** Removes only the exact U marker after its ordinary parent prompt succeeds. */
  readonly settleTerminal: (terminal: Terminal) => Effect.Effect<void>
  readonly absent: (reservation: Reservation) => Effect.Effect<void>
  readonly observeTurn: (input: { assistant: SessionV1.WithParts; clean: boolean }) => Effect.Effect<void>
  readonly needsWake: () => boolean
  readonly beginWake: () => Effect.Effect<boolean>
  readonly endWake: () => Effect.Effect<void>
  readonly exhaustWake: () => Effect.Effect<void>
  readonly finishContinuation: () => Effect.Effect<void>
  /** Records a coordination failure without claiming a cause that this layer cannot prove. */
  readonly degrade: () => Effect.Effect<void>
  readonly claimCancellation: (status?: string) => Effect.Effect<void>
  readonly result: (fallback: SessionV1.WithParts) => Effect.Effect<TaskSelectedReturn>
  readonly close: () => Effect.Effect<void>
}

export interface TaskInterface {
  readonly open: (sessionID: SessionID) => Effect.Effect<Scope, Error>
  /**
   * The scope registry is per-Instance and selected by the ambient directory, so locating a scope
   * is necessarily an effectful read.
   */
  readonly locate: (sessionID: SessionID) => Effect.Effect<Scope | undefined>
  /**
   * CP-032 R-08: the BORROW lookup, deliberately distinct from `locate`.
   *
   * A scope that has published its resolution stays registered until `closeNow` unregisters it, and
   * in that window it is unusable: `reserve` throws, `own` returns silently on the `closed` guard
   * (so no typed refusal is minted), and `result` hands back the EARLIER resolution and fallback. A
   * supplement that borrowed one would therefore file the earlier position, which the filing guard
   * already holds, and lose its own answer with no note and no error.
   *
   * `locate` keeps returning it on purpose. `tool/task.ts` reconciles the carried parent scope
   * against the registry by object identity and treats disagreement as a coordination fault, so
   * hiding a resolved scope there would fail delegated calls rather than protect them.
   */
  readonly locateBorrowable: (sessionID: SessionID) => Effect.Effect<Scope | undefined>
  readonly claim: (sessionID: SessionID) => Effect.Effect<Claim>
  readonly settleClaim: (claim: Claim, active: boolean) => Effect.Effect<void>
  readonly awaitClaim: (claim: Claim) => Effect.Effect<boolean>
}

export interface Interface extends TaskInterface {
  /** Core-participant-only capture; the Task-held Scope cannot mint fence evidence. */
  readonly captureFence: (sessionID: SessionID, ref: Ports.ParticipantFenceRef) => Effect.Effect<boolean>
  /** Cancels only the exact attachment Scope bound when this core fence was claimed. */
  readonly claimCancellationAtFence: (sessionID: SessionID, ref: Ports.ParticipantFenceRef) => Effect.Effect<boolean>
}

/**
 * The one attachment-scope finalizer used by Task production and closure integration.
 * Interruption is explicit cancellation. Every other failed exit degrades to the best observed output.
 */
export const finalizeScope = <A, E>(scope: Scope, exit: Exit.Exit<A, E>) =>
  Effect.gen(function* () {
    if (Exit.hasInterrupts(exit)) yield* scope.claimCancellation("cancelled")
    if (Exit.isFailure(exit) && scope.current().everAttached && !scope.current().failed) yield* scope.degrade()
    yield* scope.close()
  })

export class Service extends Context.Service<Service, Interface>()("@opencode/AttachmentCoordinator") {}

export function isScope(scope: unknown): scope is Scope {
  return (
    typeof scope === "object" &&
    scope !== null &&
    "observeTurn" in scope &&
    "claimObserver" in scope &&
    "settleTerminal" in scope &&
    "degrade" in scope &&
    "result" in scope
  )
}

type Job = {
  readonly token: string
}

type FenceSnapshot = {
  readonly sessionID: SessionID
  /** Exact process-local attachment-lifetime capability; never resolved again by SessionID. */
  readonly claimCancellation: Scope["claimCancellation"]
}

type Resolution =
  | Omit<Extract<TaskSelectedReturn, { type: "evidence" }>, "fallback">
  | Extract<TaskSelectedReturn, { type: "cancelled" }>

type State = {
  readonly scopeID: string
  readonly sessionID: SessionID
  readonly done: Deferred.Deferred<Resolution>
  /** Child SessionID groups one local observer cohort; it is not invocation or delivery identity. */
  readonly jobs: Map<SessionID, Job>
  /** Exact elected cohort tokens survive J -> U so late already-issued reservations cannot re-elect. */
  readonly observers: Set<string>
  /** Exact opaque terminal markers remain until successful parent persistence, cancellation, or close. */
  readonly undelivered: Map<string, Terminal>
  readonly messages: Set<MessageID>
  epoch: number
  everAttached: boolean
  active: number
  wakes: number
  wakeEpoch?: number
  order: number
  candidate?: TaskTurnEvidence
  observed?: TaskTurnEvidence
  /**
   * The local strong root for a bound ref. Core release drops its own root; this one remains until
   * `close`, so a leaked scope can retain one small ref/snapshot. Normal Task finalization closes it.
   */
  fence?: Ports.ParticipantFenceRef
  degraded: boolean
  fallback?: SessionV1.WithParts
  cancellationStatus?: string
    cancelled: boolean
    closed: boolean
    /**
     * CP-032 §3.3.2 — every Assistant a future resolution would legitimately speak for.
     *
     * Monotonic and append-only WHILE UNRESOLVED: an accepted `observeTurn` enrols its Assistant,
     * and so does every `result()` call that enters while unresolved, including waiters whose
     * fallback never latches. `invalidate()` deliberately does NOT clear it. Candidate and observed
     * are single replaceable slots, so a superseded or yielded Assistant disappears from them while
     * remaining something the eventual resolution speaks for; membership is the history those slots
     * cannot keep.
     *
     * Released at publication by `publishResolution`, and nowhere else. Once a resolution exists
     * this set answers nothing — every later arrival is compared against the frozen snapshot — so
     * retaining it past that point would leave a mutable duplicate of a frozen fact in reach of any
     * future edit that forgot which of the two it was holding.
     */
    readonly members: Set<MessageID>
    /**
     * The membership frozen at evidence publication: a new non-aliasing set, never mutated
     * afterwards, so a delayed fiber reading it after `close` still sees what the resolution covered.
     * Cancellation publishes none — it has no controlling Assistant to speak for.
     *
     * `publishResolution` copies into this and then clears `members`, in that order. The order is
     * the whole guarantee: aliasing instead of copying, or clearing before copying, both leave this
     * snapshot empty and turn every covered Assistant into a falsely fresh answer.
     */
    publishedMembers?: ReadonlySet<MessageID>
    resolution?: Resolution
  }

type RegistryState = {
  readonly scopes: Map<
    SessionID,
    {
      readonly scope: Scope
      readonly captureFence: (ref: Ports.ParticipantFenceRef) => boolean
      /**
       * CP-032 R-08: this scope has published its resolution, which is the ONLY replaceable state.
       * Kept as a private thunk over the owning scope's `state` rather than exposed on `Current`,
       * so no public contract widens and no existing `current()` consumer changes.
       *
       * Deliberately NOT `closed`: `closeNow` already unregisters, so a closed scope is absent from
       * this map. Deliberately NOT `degraded`/`cancelled` while unresolved — those still throw from
       * `own()` and remain CP-031's recoverable admission failure, which R-23 preserves.
       */
      readonly resolved: () => boolean
    }
  >
  /** Core owns each ref's strong fence-lifetime root; historical snapshots therefore key weakly. */
  readonly fences: WeakMap<Ports.ParticipantFenceRef, FenceSnapshot>
  readonly claims: Map<SessionID, Extract<Claim, { owner: true }>>
}

/** The coordinator uses a distinct scope, claim, and fence registry for each ambient Instance. */
export const make = Effect.gen(function* () {
  const registries = yield* InstanceState.make(() =>
    Effect.succeed<RegistryState>({
      scopes: new Map(),
      fences: new WeakMap(),
      claims: new Map(),
    }),
  )

  const publish = (state: State) =>
    state.resolution ? Deferred.succeed(state.done, state.resolution).pipe(Effect.ignore) : Effect.void

  const open: Interface["open"] = Effect.fn("AttachmentCoordinator.open")(function* (sessionID) {
    // Resolve once so `close` unregisters from the same per-Instance registry even under a later fiber.
    const registry = yield* InstanceState.get(registries)
    const done = yield* Deferred.make<Resolution>()
    const state: State = {
      scopeID: crypto.randomUUID(),
      sessionID,
      done,
      jobs: new Map(),
      observers: new Set(),
      undelivered: new Map(),
      messages: new Set(),
      epoch: 0,
      everAttached: false,
      active: 0,
      wakes: 0,
        order: 0,
        degraded: false,
        cancelled: false,
        closed: false,
        members: new Set(),
      }

    /** A synchronous critical section: no yield, Promise, callback, or IO can interleave it. */
    const transition = <A>(fn: () => A): A => fn()

    const invalidate = () => {
      state.candidate = undefined
      state.observed = undefined
      state.order = 0
    }

    const markDegraded = () => {
      if (state.degraded || state.cancelled || state.closed || state.resolution) return
      state.degraded = true
    }

    /**
     * The ONE publication point — CP-032 §3.3.2 rules 3 and 4 applied where both are decidable.
     *
     * Copy, then clear, in that order, inside the one synchronous transition. The copy is what this
     * resolution speaks for and must never alias the mutable set; the clear is rule 4's
     * post-publication non-enrolment, taken at the instant publication makes the mutable set
     * meaningless rather than deferred to `close`.
     *
     * Deferring it to `close` cannot express both orders, which is why that arrangement was
     * replaced. `apply` runs `gate()` AFTER the transition body, so a close that degrades an
     * unresolved scope publishes after `closeNow` has already returned: a clear conditioned on
     * `state.resolution` there sees no resolution yet and skips — leaving the mutable set alive past
     * a publication — while an unconditional clear there freezes an EMPTY membership and makes every
     * later caller falsely fresh. Publication is the only site that sees the snapshot exist.
     *
     * Cancellation freezes no cohort: it has no controlling Assistant to speak for and is consumed
     * unconditionally. It is still a publication, so it releases the mutable set on the same rule.
     */
    const publishResolution = (resolution: Resolution) => {
      state.resolution = resolution
      if (resolution.type === "evidence") state.publishedMembers = new Set(state.members)
      state.members.clear()
      state.closed = true
    }

    const gate = () => {
      if (state.resolution) return
      if (state.cancelled) {
        if (state.active > 0 || state.wakes > 0) return
        publishResolution({
          type: "cancelled",
          taskID: state.sessionID,
          status: state.cancellationStatus ?? "unknown",
        })
        return
      }
      if (state.degraded) {
        if (state.active > 0 || state.wakes > 0) return
        if (!state.candidate && !state.observed && !state.fallback) return
        publishResolution({
          type: "evidence",
          candidate: state.candidate,
          observed: state.observed,
          degraded: true,
        })
        return
      }
      if (!state.everAttached) return
      if (!state.candidate && !(state.observed && state.wakeEpoch === state.epoch)) return
      if (state.jobs.size > 0) return
      if (state.undelivered.size > 0) return
      if (state.active > 0) return
      if (state.wakes > 0) return
      if (state.candidate && state.candidate.epoch !== state.epoch) return
      if (state.observed && state.observed.epoch !== state.epoch) return
      publishResolution({
        type: "evidence",
        candidate: state.candidate,
        observed: state.observed,
        degraded: false,
      })
    }

    const closeNow = () => {
      if (registry.scopes.get(sessionID)?.scope.id === state.scopeID) registry.scopes.delete(sessionID)
      if (!state.resolution && !state.degraded && !state.cancelled) markDegraded()
      state.closed = true
      state.fence = undefined
      state.jobs.clear()
      state.observers.clear()
      state.undelivered.clear()
      state.messages.clear()
      // Membership is deliberately untouched here, in BOTH directions. `apply` runs `gate()` after
      // this body, so a close that degrades an unresolved scope publishes afterwards and must still
      // find the real membership to freeze; and once a publication has happened it has already
      // released the set itself. The frozen `publishedMembers` is never touched here either —
      // delayed exact-scope fibers still read it after close.
    }

    const apply = <A>(fn: () => A) =>
      Effect.uninterruptible(
        Effect.sync(() => transition(fn)).pipe(
          Effect.exit,
          Effect.tap(() => Effect.sync(gate)),
          Effect.tap(() => publish(state)),
          Effect.flatMap((exit) => (Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.failCause(exit.cause))),
        ),
      )

    const current = (): AttachmentContract.Current =>
      transition(() => ({
        scopeID: state.scopeID,
        epoch: state.epoch,
        attached: state.jobs.size,
        undelivered: state.undelivered.size,
        everAttached: state.everAttached,
        candidate: state.candidate !== undefined,
      failed: state.degraded,
      cancelled: state.cancelled,
    }))

    const own: Scope["own"] = (messageID) =>
      apply(() => {
        // CP-032 R-08. The refusal keys on a PUBLISHED RESOLUTION, never on `closed`.
        //
        // Every resolution sets `closed`, so the two are easy to conflate — and conflating them is a
        // regression, not a nuance. Only a resolved scope carries the hazard: it holds an answer a
        // later `result()` would replay, so admitting onto it loses the distinct answer silently. A
        // borrow check earlier cannot rule this out, because admission yields through
        // `revert.cleanup` and `createUserMessage` between discovery and this call.
        //
        // A scope merely TORN DOWN has no answer to replay. `finalizeOwnerScope(Exit.void)` closes
        // and degrades it, and the gate cannot resolve without evidence, so it sits closed and
        // unresolved. Refusing there fails a run that used to proceed through the ordinary degraded
        // route — see `closure-task-boundaries.test.ts` "refuses the real Task result notifier
        // before scheduling its observer (K9 result)". Those scopes keep the historical no-op.
        //
        // Refusing is not a lost prompt. `promptAdmitted` converts `false` into the typed
        // `SessionScopeOwnRefused`, which CP-032 B-7 retains as a sanitized note. The boundary is
        // exact and narrower than "pre-admission": the refusal lands AFTER durable persistence of
        // the User message and its Parts, but BEFORE Task's `onAdmitted` flag. That is why it
        // classifies as a note rather than a post-admission failure, and why the cost is a
        // persisted prompt rather than a lost one: `supplementalAdmissionNote` discloses that the
        // prompt may already be in the transcript, and `ownLatestUser` adopts an unowned latest
        // User message on a later scoped run.
        // Non-admission callers — the summary path and `ownLatestUser` itself — ignore the boolean.
        if (state.resolution) return false
        if (state.closed) return true
        if (state.degraded || state.cancelled) {
          throw new Error(`Attachment scope ${state.scopeID} cannot own another message`)
        }
        state.messages.add(messageID)
        invalidate()
        return true
      })

    const owns: Scope["owns"] = (messageID) => transition(() => state.messages.has(messageID))

    const reserve: Scope["reserve"] = (jobID) =>
      apply(() => {
        if (state.degraded || state.cancelled || state.closed || state.resolution) {
          throw new Error(`Attachment scope ${state.scopeID} cannot reserve another job`)
        }
        state.epoch++
        const existing = state.jobs.get(jobID)
        const token = existing?.token ?? crypto.randomUUID()
        const fresh = !existing
        if (fresh) state.jobs.set(jobID, { token })
        invalidate()
        return { scopeID: state.scopeID, jobID, token, fresh }
      })

    const reject: Scope["reject"] = (reservation) =>
      apply(() => {
        if (reservation.scopeID !== state.scopeID) {
          throw new Error(`Reservation does not belong to attachment scope ${state.scopeID}`)
        }
        if (!reservation.fresh) return
        const job = state.jobs.get(reservation.jobID)
        if (!job || job.token !== reservation.token || state.observers.has(reservation.token)) return
        state.jobs.delete(reservation.jobID)
      })

    const claimObserver: Scope["claimObserver"] = (reservation) =>
      apply(() => {
        if (reservation.scopeID !== state.scopeID) {
          markDegraded()
          return { type: "unavailable", reason: "invalid" }
        }
        // Election outlives the live J entry. A second reservation issued for the same cohort may
        // reach this seam only after the owner has moved J -> U (or settled U); it is still the same
        // exact token and therefore cannot mint another notifier. Explicit close/cancellation clear
        // the set, so their unavailable dispositions remain authoritative.
        if (state.observers.has(reservation.token)) return { type: "existing" }
        if (state.cancelled) return { type: "unavailable", reason: "cancelled" }
        if (state.closed || state.resolution) return { type: "unavailable", reason: "closed" }
        const job = state.jobs.get(reservation.jobID)
        if (!job || job.token !== reservation.token) {
          markDegraded()
          return { type: "unavailable", reason: "invalid" }
        }
        // A degraded scope still needs at most one ordinary notifier for this exact child cohort.
        // Retain the cohort token as the atomic winner without manufacturing attachment
        // history or active work: best-evidence resolution remains free to complete immediately.
        if (state.degraded) {
          state.observers.add(reservation.token)
          return { type: "fallback" }
        }
        state.everAttached = true
        invalidate()
        state.observers.add(reservation.token)
        state.active++
        return { type: "owner" }
      })

    const terminal: Scope["terminal"] = (reservation) =>
      apply(() => {
        if (state.degraded || state.cancelled || state.closed || state.resolution) return undefined
        if (reservation.scopeID !== state.scopeID) {
          markDegraded()
          return undefined
        }
        const job = state.jobs.get(reservation.jobID)
        if (!job || job.token !== reservation.token || !state.observers.has(reservation.token)) {
          markDegraded()
          return undefined
        }
        state.jobs.delete(reservation.jobID)
        const marker: Terminal = { scopeID: state.scopeID, token: crypto.randomUUID() }
        state.undelivered.set(marker.token, marker)
        invalidate()
        return marker
      })

    const settleTerminal: Scope["settleTerminal"] = (marker) =>
      apply(() => {
        if (marker.scopeID !== state.scopeID) return
        if (state.undelivered.get(marker.token) !== marker) return
        state.undelivered.delete(marker.token)
      })

    const absent: Scope["absent"] = (reservation) =>
      apply(() => {
        if (reservation.scopeID !== state.scopeID) {
          markDegraded()
          return
        }
        const job = state.jobs.get(reservation.jobID)
        if (!job || job.token !== reservation.token) {
          markDegraded()
          return
        }
        state.jobs.delete(reservation.jobID)
        markDegraded()
      })

    const observeTurn: Scope["observeTurn"] = (input) => {
      const assistant = structuredClone(input.assistant)
      return apply(() => {
          if (state.degraded || state.cancelled || state.closed) return
          // Enrolled before `apply` runs `gate()`, so any resolution this observation enables is
          // frozen with it already inside. A refused observation above never enrols, and `closed`
          // covers the post-resolution case because every publication sets it.
          state.members.add(assistant.info.id)
          const evidence = { epoch: state.epoch, order: ++state.order, assistant }
          if (input.clean) state.candidate = evidence
          if (!input.clean) state.observed = evidence
      })
    }

    const needsWake = () =>
      transition(
        () =>
          state.everAttached &&
          !state.degraded &&
          !state.cancelled &&
          !state.closed &&
          !state.resolution &&
          state.jobs.size === 0 &&
          state.undelivered.size === 0 &&
          !state.candidate,
      )

    const beginWake: Scope["beginWake"] = () =>
      apply(() => {
        if (!needsWake()) return false
        if (state.wakeEpoch === state.epoch) return false
        state.wakeEpoch = state.epoch
        state.wakes++
        return true
      })

    const endWake: Scope["endWake"] = () =>
      apply(() => {
        if (state.wakes > 0) state.wakes--
      })

    const exhaustWake: Scope["exhaustWake"] = () =>
      apply(() => {
        if (!needsWake()) return
        if (state.wakeEpoch !== state.epoch) return
        if (state.observed) return
        markDegraded()
      })

    const finishContinuation: Scope["finishContinuation"] = () =>
      apply(() => {
        if (state.active > 0) state.active--
      })

    const degrade: Scope["degrade"] = () => apply(markDegraded)

    const cancel = (status?: string) => {
      if (state.cancelled) return
      state.cancelled = true
      state.candidate = undefined
      state.observed = undefined
      state.order = 0
      state.jobs.clear()
      state.observers.clear()
      state.undelivered.clear()
      state.cancellationStatus = status
    }

    const claimCancellation: Scope["claimCancellation"] = (status) => apply(() => cancel(status))

    const captureFence = (ref: Ports.ParticipantFenceRef) =>
      transition(() => {
        if (state.fence || state.cancelled || state.closed || state.resolution) return false
        const snapshot: FenceSnapshot = {
          sessionID: state.sessionID,
          claimCancellation,
        }
        registry.fences.set(ref, snapshot)
        state.fence = ref
        return true
      })

    const complete = (resolution: Resolution, fallback: SessionV1.WithParts): TaskSelectedReturn =>
      resolution.type === "cancelled" ? resolution : { ...resolution, fallback }

    /**
     * CP-032 §3.3.2 Admission Freshness.
     *
     * The whole decision lives inside the existing synchronous transition, before any await or
     * caller-visible selection, because the question it answers — was this scope already resolved
     * when I arrived? — cannot be asked from outside and still be true when `result()` runs. A
     * caller that samples first and calls second has no way to bind the two.
     *
     * The discriminator is `published`: the resolution as it stood when the transition BEGAN, read
     * before the first-fallback latch and before `gate()`. A resolution that `gate()` publishes
     * during this call was computed for THIS turn and is consumed unconditionally; only a resolution
     * that predates the call is a candidate for freshness.
     */
    const result: Scope["result"] = (fallback) =>
      Effect.gen(function* () {
        const cloned = structuredClone(fallback)
        const immediate = transition(() => {
          const published = state.resolution
          if (published) {
            // Cancellation is global: it carries no controlling Assistant, speaks for no membership,
            // and outranks any turn arriving after it. Nothing files.
            if (published.type === "cancelled") return complete(published, state.fallback ?? cloned)
            // Evidence, clean or degraded alike. The question is not how good the resolution is, but
            // whether it speaks for THIS Assistant. Membership answers that directly; the published
            // candidate/observed/fallback slots cannot, because they are replaceable — an Assistant
            // observed and then superseded is still covered by the resolution while no longer visible
            // in any slot, and testing the slots would falsely revive it as fresh.
            if (state.publishedMembers?.has(fallback.info.id)) {
              return complete(published, state.fallback ?? cloned)
            }
            // Not covered: this run was admitted while unresolved but had not yet reached `result()`
            // when the resolution minted, so nothing it produced is inside that answer. Returning it
            // fresh is what keeps it from vanishing behind the already-filed position. Deliberately
            // no mutation of fallback, history, or resolution — a fresh post-publication result never
            // enrols itself, or a later arrival would match retroactively.
            return { type: "evidence", fallback: cloned, degraded: false } satisfies TaskSelectedReturn
          }
          // Unresolved at entry: enrol before anything else, so any resolution this call enables is
          // frozen with this Assistant inside. Every caller enrols, including waiters whose fallback
          // never latches, because each of them is one the eventual resolution will speak for.
          state.members.add(fallback.info.id)
          state.fallback ??= cloned
          gate()
          if (state.resolution) return complete(state.resolution, state.fallback)
          if (!state.everAttached && state.jobs.size === 0 && state.undelivered.size === 0) {
            const resolution: Resolution = {
              type: "evidence",
              candidate: state.candidate,
              observed: state.observed,
              degraded: state.degraded,
            }
            // The third evidence publication point, alongside the two in `gate()`. This one mints
            // immediately for a never-attached scope, so its membership is usually just this caller
            // — which is precisely why it goes through the shared `publishResolution` rather than
            // inlining the two writes. Swapping copy and clear here would freeze an empty snapshot
            // and make this same caller's own next arrival read as a distinct fresh answer.
            publishResolution(resolution)
            return complete(resolution, state.fallback)
          }
          return undefined
        })
        if (immediate) return immediate
        const resolution = yield* Deferred.await(state.done)
        return transition(() => complete(resolution, state.fallback ?? cloned))
      })

    const close: Scope["close"] = () => apply(closeNow)

    const handle: Scope = {
      id: state.scopeID,
    sessionID,
    current,
    own,
    owns,
      reserve,
      reject,
      claimObserver,
      terminal,
      settleTerminal,
      absent,
      observeTurn,
      needsWake,
      beginWake,
      endWake,
      exhaustWake,
      finishContinuation,
      degrade,
      claimCancellation,
      result,
      close,
    }

    const entry = {
      scope: handle,
      captureFence,
      resolved: () => state.resolution !== undefined,
    }

    // CP-032 R-08. One synchronous critical section, so check-and-replace is atomic by
    // construction: `Effect.sync` cannot yield, and `closeNow`'s delete runs inside `transition`,
    // which cannot either. No new lock is needed.
    //
    // A LIVE incumbent still refuses the open — CP-031's exclusivity, unchanged, and the path that
    // keeps producing the typed `SessionScopeOwnRefused` note for a degraded-but-unresolved scope.
    // A RESOLVED incumbent is replaced in place: it can no longer serve a borrower, and leaving it
    // registered is exactly what made a later supplement's distinct answer vanish into the earlier
    // filed position with no note and no error.
    //
    // The predecessor is not closed here; its own finalizer still runs and is identity-safe.
    // `closeNow` deletes only while the registered scope id is still its own, and `scopeID` is a
    // fresh UUID per open, so the predecessor cannot evict the successor.
    const registered = yield* Effect.sync(() => {
      const incumbent = registry.scopes.get(sessionID)
      if (incumbent && !incumbent.resolved()) return false
      // The predecessor's fence snapshot is deliberately left bound to the predecessor. A fence ref
      // authorizes the exact scope generation it was captured on, never the session's future
      // successor — the standing contract proved by "captureFence and claimCancellationAtFence bind
      // exact scope generations". Deleting or forwarding it here would manufacture authority over a
      // generation the ref never named. The successor stays fence-capable because `captureFence`
      // resolves an unretained ref through `registry.scopes.get(sessionID)`, which is now the
      // successor.
      registry.scopes.set(sessionID, entry)
      return true
    })
    if (!registered) return yield* Effect.fail(new Error(`Attachment scope already open for session ${sessionID}`))
    yield* publish(state)
    return handle
  })

  const claim: Interface["claim"] = Effect.fn("AttachmentCoordinator.claim")(function* (sessionID) {
    const registry = yield* InstanceState.get(registries)
    const ready = yield* Deferred.make<boolean>()
    return yield* Effect.sync(() => {
      const existing = registry.claims.get(sessionID)
      if (existing) return { owner: false as const, sessionID, ready: existing.ready }
      const owner = { owner: true as const, sessionID, token: {}, ready }
      registry.claims.set(sessionID, owner)
      return owner
    })
  })

  const settleClaim: Interface["settleClaim"] = Effect.fn("AttachmentCoordinator.settleClaim")(
    function* (claim, active) {
      if (!claim.owner) return
      const registry = yield* InstanceState.get(registries)
      yield* Effect.uninterruptible(
        Effect.sync(() => {
          const current = registry.claims.get(claim.sessionID)
          if (current?.token === claim.token) registry.claims.delete(claim.sessionID)
        }).pipe(Effect.andThen(Deferred.succeed(claim.ready, active)), Effect.ignore),
      )
    },
  )

  const awaitClaim: Interface["awaitClaim"] = (claim) =>
    claim.owner ? Effect.succeed(true) : Deferred.await(claim.ready)

  const locate: Interface["locate"] = Effect.fn("AttachmentCoordinator.locate")(function* (sessionID) {
    const registry = yield* InstanceState.get(registries)
    return registry.scopes.get(sessionID)?.scope
  })

  // CP-032 R-08. Raw `locate` stays raw because two of its three production consumers need registry
  // truth rather than usability: `tool/task.ts` reconciles the carried parent scope by object
  // identity and fails the call on disagreement, and `attachment/participant.ts` reports covered
  // edges for closure proof and must not narrow the proven set. Only `executeSupplement`'s borrow
  // needs the qualified answer, so the qualification lives here rather than inside `locate`.
  const locateBorrowable: Interface["locateBorrowable"] = Effect.fn("AttachmentCoordinator.locateBorrowable")(
    function* (sessionID) {
      const registry = yield* InstanceState.get(registries)
      const entry = registry.scopes.get(sessionID)
      if (!entry || entry.resolved()) return undefined
      return entry.scope
    },
  )

  const captureFence: Interface["captureFence"] = Effect.fn("AttachmentCoordinator.captureFence")(
    function* (sessionID, ref) {
      const registry = yield* InstanceState.get(registries)
      const retained = registry.fences.get(ref)
      if (retained) return retained.sessionID === sessionID
      return registry.scopes.get(sessionID)?.captureFence(ref) ?? false
    },
  )

  const claimCancellationAtFence: Interface["claimCancellationAtFence"] = Effect.fn(
    "AttachmentCoordinator.claimCancellationAtFence",
  )(function* (sessionID, ref) {
    const registry = yield* InstanceState.get(registries)
    const snapshot = registry.fences.get(ref)
    if (snapshot?.sessionID !== sessionID) return false
    yield* snapshot.claimCancellation()
    return true
  })

  return Service.of({
    open,
    locate,
    locateBorrowable,
    captureFence,
    claimCancellationAtFence,
    claim,
    settleClaim,
    awaitClaim,
  })
})

export const layer = Layer.effect(Service, make)

export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as AttachmentCoordinator from "./coordinator"
