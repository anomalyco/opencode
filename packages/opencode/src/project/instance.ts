import { Effect } from "effect"
import { context, type InstanceContext } from "./instance-context"
import { InstanceStore } from "./instance-store"

export type { InstanceContext } from "./instance-context"
export type { LoadInput } from "./instance-store"

export const Instance = {
  async provide<R>(input: { directory: string; init?: Effect.Effect<void>; fn: () => R }): Promise<R> {
    const ctx = await InstanceStore.runtime.runPromise((store) =>
      store.load({ directory: input.directory, init: input.init }),
    )
    return context.provide(ctx, async () => input.fn())
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
  // followup: `reload` survives because `test/server/project-init-git.test.ts`
  // spies on this exact method. Once that test asserts on `InstanceStore.reloadInstance`
  // (or moves to an Effect runtime), this wrapper can drop.
  async reload(input: InstanceStore.LoadInput) {
    return InstanceStore.reloadInstance(input)
  },
  // followup: `dispose` survives for legacy fixtures that read `Instance.current`
  // out of ALS (e.g. `test/fixture/fixture.ts` `provideTmpdirInstance`,
  // `test/question/question.test.ts` cancellation tests). Convert those to call
  // `InstanceStore.disposeInstance(ctx)` directly once `Instance.provide` is gone.
  async dispose() {
    return InstanceStore.disposeInstance(Instance.current)
  },
}
