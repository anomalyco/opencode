import { Effect, Layer, ManagedRuntime } from "effect"
import { Account } from "@/account/effect"
import { Auth } from "@/auth/effect"
import { Instances } from "@/effect/instances"
import type { InstanceServices } from "@/effect/instances"
import { Installation } from "@/installation"
import { Truncate } from "@/tool/truncate-effect"
import { Instance } from "@/project/instance"

export const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    Account.defaultLayer, //
    Installation.defaultLayer,
    Truncate.defaultLayer,
    Instances.layer,
  ).pipe(Layer.provideMerge(Auth.layer)),
)

export function runPromiseInstance<A, E>(effect: Effect.Effect<A, E, InstanceServices>) {
  return runtime.runPromise(effect.pipe(Effect.provide(Instances.get(Instance.directory))))
}

export function disposeRuntime() {
  return runtime.dispose()
}
