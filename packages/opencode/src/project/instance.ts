import { Effect } from "effect"
import { InstanceRef } from "@/effect/instance-ref"
import * as Project from "./project"
import { context, type InstanceContext } from "./instance-context"
import { InstanceStore } from "./instance-store"

export type { InstanceContext } from "./instance-context"
export type { LoadInput } from "./instance-store"

type LegacyLoadInput = {
  directory: string
  init?: Effect.Effect<void>
  project?: Project.Info
  worktree?: string
}

// Bind ALS around init so legacy code reachable through it (Instance.directory reads, etc.)
// stays bound. The Effect-typed init also gets InstanceRef provided by the store.
const liftLegacyInput = (input: LegacyLoadInput): InstanceStore.LoadInput => {
  const { init, ...rest } = input
  if (!init) return rest
  return {
    ...rest,
    init: Effect.gen(function* () {
      const ctx = yield* InstanceRef
      if (!ctx) return yield* init
      yield* Effect.callback<void>((resume) => {
        context.provide(ctx, () => {
          Effect.runPromise(init).then(
            () => resume(Effect.void),
            (err) => resume(Effect.die(err)),
          )
        })
      })
    }),
  }
}

export const Instance = {
  load(input: LegacyLoadInput): Promise<InstanceContext> {
    return InstanceStore.runtime.runPromise((store) => store.load(liftLegacyInput(input)))
  },
  async provide<R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }): Promise<R> {
    return context.provide(
      await Instance.load({ directory: input.directory, init: input.init }),
      async () => input.fn(),
    )
  },
  get current() {
    return context.use()
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },

  /**
   * Captures the current instance ALS context and returns a wrapper that
   * restores it when called. Use this for callbacks that fire outside the
   * instance async context (native addons, event emitters, timers, etc.).
   */
  bind<F extends (...args: any[]) => any>(fn: F): F {
    const ctx = context.use()
    return ((...args: any[]) => context.provide(ctx, () => fn(...args))) as F
  },
  /**
   * Run a synchronous function within the given instance context ALS.
   * Use this to bridge from Effect (where InstanceRef carries context)
   * back to sync code that reads Instance.directory from ALS.
   */
  restore<R>(ctx: InstanceContext, fn: () => R): R {
    return context.provide(ctx, fn)
  },
  async reload(input: LegacyLoadInput) {
    return InstanceStore.runtime.runPromise((store) => store.reload(liftLegacyInput(input)))
  },
  async dispose() {
    return InstanceStore.runtime.runPromise((store) => store.dispose(Instance.current))
  },
  async disposeAll() {
    return InstanceStore.runtime.runPromise((store) => store.disposeAll())
  },
}
