import { Effect, Layer, ManagedRuntime } from "effect"
import { AccountEffect } from "@/account/effect"
import { AuthEffect } from "@/auth/effect"
import { Instances } from "@/effect/instances"
import type { InstanceServices } from "@/effect/instances"
import { TruncateEffect } from "@/tool/truncate-effect"
import { Instance } from "@/project/instance"

export const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    AccountEffect.defaultLayer, //
    TruncateEffect.defaultLayer,
    Instances.layer,
  ).pipe(Layer.provideMerge(AuthEffect.layer)),
)

export function runPromiseInstance<A, E>(effect: Effect.Effect<A, E, InstanceServices>) {
  return runtime.runPromise(effect.pipe(Effect.provide(Instances.get(Instance.directory))))
}

export function disposeRuntime() {
  return runtime.dispose()
}
