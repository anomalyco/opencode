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
  readonly own: (messageID: MessageID) => Effect.Effect<void>
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
  resolution?: Resolution
}

type RegistryState = {
  readonly scopes: Map<
    SessionID,
    {
      readonly scope: Scope
      readonly captureFence: (ref: Ports.ParticipantFenceRef) => boolean
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

    const gate = () => {
      if (state.resolution) return
      if (state.cancelled) {
        if (state.active > 0 || state.wakes > 0) return
        state.resolution = {
          type: "cancelled",
          taskID: state.sessionID,
          status: state.cancellationStatus ?? "unknown",
        }
        state.closed = true
        return
      }
      if (state.degraded) {
        if (state.active > 0 || state.wakes > 0) return
        if (!state.candidate && !state.observed && !state.fallback) return
        state.resolution = {
          type: "evidence",
          candidate: state.candidate,
          observed: state.observed,
          degraded: true,
        }
        state.closed = true
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
      state.resolution = {
        type: "evidence",
        candidate: state.candidate,
        observed: state.observed,
        degraded: false,
      }
      state.closed = true
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
        if (state.closed) return
        if (state.degraded || state.cancelled || state.resolution) {
          throw new Error(`Attachment scope ${state.scopeID} cannot own another message`)
        }
        state.messages.add(messageID)
        invalidate()
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

    const result: Scope["result"] = (fallback) =>
      Effect.gen(function* () {
        const cloned = structuredClone(fallback)
        const immediate = transition(() => {
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
            state.resolution = resolution
            state.closed = true
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

    const registered = yield* Effect.sync(() => {
      if (registry.scopes.has(sessionID)) return false
      registry.scopes.set(sessionID, { scope: handle, captureFence })
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
