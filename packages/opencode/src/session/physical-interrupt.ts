import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { InstanceState } from "@/effect/instance-state"
import { BackgroundJob } from "@/background/job"
import { Context, Deferred, Effect, Layer, SynchronizedRef } from "effect"
import { SessionID } from "./schema"
import { SessionRunState } from "./run-state"
import { SessionClosure } from "./closure/coordinator"

/**
 * Exact interruption for finalizers that cannot safely call full closure without waiting on
 * themselves. In-flight work is deduplicated under a private lock and interrupted after release.
 * Closure receives this through ports because a layer dependency through `SessionRunState` cycles.
 */

/** A lifetime token is ABA-safe; a reusable public job id could name its replacement. */
export type Target =
  | { readonly type: "session"; readonly session: SessionID }
  | { readonly type: "lifetime"; readonly lifetime: BackgroundJob.Lifetime }

/** `absent` is not success; `adopted` and `in_progress` distinguish who may await existing work. */
export type Outcome =
  | { readonly type: "interrupted" }
  | { readonly type: "adopted" }
  | { readonly type: "in_progress" }
  | { readonly type: "absent" }

export interface Interface {
  readonly interruptExact: (target: Target) => Effect.Effect<Outcome>

  /**
   * A target's own finalizer never awaits an existing interrupt, because that interrupt cannot
   * complete until the finalizer returns. It still performs the interrupt when no owner exists.
   */
  readonly reportExact: (target: Target) => Effect.Effect<Outcome>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPhysical") {}

type Key = SessionID | object

type Registry = Map<Key, Deferred.Deferred<Outcome>>

type Claim =
  | { readonly kind: "joined"; readonly signal: Deferred.Deferred<Outcome> }
  | { readonly kind: "owner"; readonly signal: Deferred.Deferred<Outcome> }

const key = (target: Target): Key => (target.type === "session" ? target.session : target.lifetime.token)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const runState = yield* SessionRunState.Service

    const state = yield* InstanceState.make(
      Effect.fn("SessionPhysical.state")(() =>
        SynchronizedRef.make(new Map() as Registry).pipe(Effect.map((inflight) => ({ inflight }))),
      ),
    )

    const claim = Effect.fn("SessionPhysical.claim")(function* (target: Target) {
      const data = yield* InstanceState.get(state)
      return yield* SynchronizedRef.modifyEffect(
        data.inflight,
        Effect.fnUntraced(function* (map: Registry) {
          const existing = map.get(key(target))
          if (existing) return [{ kind: "joined", signal: existing }, map] as readonly [Claim, Registry]
          const signal = yield* Deferred.make<Outcome>()
          return [{ kind: "owner", signal }, new Map(map).set(key(target), signal)] as readonly [Claim, Registry]
        }),
      )
    })

    /** Uses the narrow runner interrupt; `cancel` also performs recursive job discovery. */
    const perform = Effect.fn("SessionPhysical.perform")(function* (target: Target) {
      if (target.type === "session") {
        const present = yield* runState.interruptRunner(target.session)
        return (present ? { type: "interrupted" } : { type: "absent" }) satisfies Outcome
      }
      const info = yield* background.cancelExact(target.lifetime)
      return (info ? { type: "interrupted" } : { type: "absent" }) satisfies Outcome
    })

    /** Always removes the entry and completes its signal so adopters cannot remain stranded. */
    const own = Effect.fn("SessionPhysical.own")(function* (target: Target, signal: Deferred.Deferred<Outcome>) {
      const data = yield* InstanceState.get(state)
      const release = Effect.gen(function* () {
        yield* SynchronizedRef.update(data.inflight, (map) => {
          const next = new Map(map)
          next.delete(key(target))
          return next
        })
        // Failure proves no interruption; report `absent` rather than leave adopters hanging.
        yield* Deferred.succeed(signal, { type: "absent" } satisfies Outcome).pipe(Effect.ignore)
      })
      return yield* perform(target).pipe(
        Effect.tap((result) => Deferred.succeed(signal, result)),
        Effect.ensuring(release),
      )
    })

    const interruptExact: Interface["interruptExact"] = Effect.fn("SessionPhysical.interruptExact")(function* (target) {
      const claimed = yield* claim(target)
      if (claimed.kind === "owner") return yield* own(target, claimed.signal)
      yield* Deferred.await(claimed.signal)
      return { type: "adopted" } satisfies Outcome
    })

    const reportExact: Interface["reportExact"] = Effect.fn("SessionPhysical.reportExact")(function* (target) {
      const claimed = yield* claim(target)
      if (claimed.kind === "owner") return yield* own(target, claimed.signal)
      // A finalizer must not await the interrupt that is waiting for that finalizer.
      return { type: "in_progress" } satisfies Outcome
    })

    return Service.of({ interruptExact, reportExact })
  }),
)

/** Reuses the dependency objects that `SessionRunState.defaultLayer` memoizes. */
export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [BackgroundJob.node, SessionRunState.node, SessionClosure.node],
})

export * as SessionPhysical from "./physical-interrupt"
