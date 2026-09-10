import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Semaphore } from "effect"
import { InstanceState } from "@/effect/instance-state"
import type { MessageID, PartID, SessionID } from "./schema"

/**
 * In-process authority for one exact ToolPart terminal transition.
 * Authority lives in per-Instance WeakMaps, not serializable tokens. The coordinator mints a grant
 * under its lock; the adapter later derives a single-use Part permit. Revocation and writes share a
 * semaphore, and both services share one layer-backed registry.
 */

declare const GrantBrand: unique symbol
declare const PermitBrand: unique symbol

export type Grant = { readonly [GrantBrand]: true }

export type Permit = { readonly [PermitBrand]: true }

export type Coordinate = {
  readonly session: SessionID
  readonly message: MessageID
  readonly part: PartID
}

export type Authority = {
  readonly instance: string
  readonly operation: string
}

export type Transition = "active_to_terminal"

export type Binding = Authority &
  Coordinate & {
    readonly transition: Transition
    /** The live grant ties diagnostic labels and exact coordinates to enforceable authority. */
    readonly holder: Grant
  }

/** `revoke` closes over the mint-time record and waits for any admitted write holding its gate. */
export type Issued = {
  readonly grant: Grant
  readonly revoke: Effect.Effect<void>
}

/** Discriminated because a successful write may itself return `undefined`. */
export type Committed<A> = { readonly committed: true; readonly value: A } | { readonly committed: false }

/** Synchronous minting stays inside the coordinator's certification critical section. */
export interface Minter {
  readonly mint: (authority: Authority) => Issued
}

export interface IssuerInterface {
  /**
   * Resolves the ambient Instance's registry before returning its bound allocator.
   */
  readonly minter: Effect.Effect<Minter>
}

export interface Interface {
  /**
   * Issuance is ungated because it does not write; `consume` and `commit` enforce revocation.
   */
  readonly issue: (holder: Grant, coordinate: Coordinate) => Effect.Effect<Permit | undefined>
  /** Reads and retires one permit; refused permits are spent too. */
  readonly consume: (permit: Permit) => Effect.Effect<Binding | undefined>
  /**
   * Runs `write` atomically with revocation. The preceding database read stays outside because it
   * cannot mutate state.
   */
  readonly commit: <A, E, R>(holder: Grant, write: Effect.Effect<A, E, R>) => Effect.Effect<Committed<A>, E, R>
}

export class Issuer extends Context.Service<Issuer, IssuerInterface>()("@opencode/SessionToolPartIssuer") {}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionToolPartPermit") {}

/** `live` is protected by `gate` and remains visible to commits that already hold this record. */
type GrantRecord = {
  readonly authority: Authority
  readonly gate: Semaphore.Semaphore
  live: boolean
}

/** Weak maps avoid retaining or enumerating abandoned capabilities; Instance disposal drops both. */
type Registry = {
  readonly grants: WeakMap<Grant, GrantRecord>
  readonly permits: WeakMap<Permit, Binding>
}

export const layer = Layer.effectContext(
  Effect.gen(function* () {
    /** One per-Instance registry backs both tags; separate registries would invalidate every grant. */
    const state = yield* InstanceState.make<Registry>(
      Effect.fn("SessionToolPartPermit.registry")(() =>
        Effect.succeed({ grants: new WeakMap<Grant, GrantRecord>(), permits: new WeakMap<Permit, Binding>() }),
      ),
    )

    const issuer = Issuer.of({
      minter: Effect.map(
        InstanceState.get(state),
        (registry): Minter => ({
          mint: (authority: Authority) => {
            const issued: Grant = {} as Grant
            const record: GrantRecord = {
              authority: { instance: authority.instance, operation: authority.operation },
              gate: Semaphore.makeUnsafe(1),
              live: true,
            }
            registry.grants.set(issued, record)
            return {
              grant: issued,
              revoke: record.gate.withPermits(1)(
                Effect.sync(() => {
                  record.live = false
                  registry.grants.delete(issued)
                }),
              ),
            } satisfies Issued
          },
        }),
      ),
    })

    const consumer = Service.of({
      issue: Effect.fn("SessionToolPartPermit.issue")(function* (holder: Grant, coordinate: Coordinate) {
        const registry = yield* InstanceState.get(state)
        const record = registry.grants.get(holder)
        if (!record || !record.live) return undefined
        const issued: Permit = {} as Permit
        registry.permits.set(issued, {
          instance: record.authority.instance,
          operation: record.authority.operation,
          session: coordinate.session,
          message: coordinate.message,
          part: coordinate.part,
          transition: "active_to_terminal",
          holder,
        })
        return issued
      }),

      consume: Effect.fn("SessionToolPartPermit.consume")(function* (permit: Permit) {
        const registry = yield* InstanceState.get(state)
        const binding = registry.permits.get(permit)
        if (!binding) return undefined
        registry.permits.delete(permit)
        const record = registry.grants.get(binding.holder)
        return record && record.live ? binding : undefined
      }),

      commit: <A, E, R>(holder: Grant, write: Effect.Effect<A, E, R>): Effect.Effect<Committed<A>, E, R> =>
        Effect.gen(function* () {
          const registry = yield* InstanceState.get(state)
          const record = registry.grants.get(holder)
          if (!record) return { committed: false } as Committed<A>
          return yield* record.gate.withPermits(1)(
            Effect.gen(function* () {
              if (!record.live) return { committed: false } as Committed<A>
              return { committed: true, value: yield* write } as Committed<A>
            }),
          )
        }),
    })

    return Context.make(Issuer, issuer).pipe(Context.add(Service, consumer))
  }),
)

/** Dependency-free across the closure/Session boundary; one node preserves one shared registry. */
export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as SessionToolPartPermit from "./toolpart-permit"
