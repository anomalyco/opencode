import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance-context"
import { InstanceStore } from "@/project/instance-store"
import { Effect } from "effect"

export const disposeInstance = (ctx: InstanceContext) =>
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    const bridge = yield* EffectBridge.make()
    return yield* Effect.uninterruptible(bridge.run(store.dispose(ctx)))
  })

export const reloadInstance = (ctx: InstanceContext, next: InstanceStore.LoadInput) =>
  Effect.gen(function* () {
    const store = yield* InstanceStore.Service
    const bridge = yield* EffectBridge.make()
    yield* Effect.uninterruptible(bridge.run(store.reload({ ...next, directory: ctx.directory })))
  })
