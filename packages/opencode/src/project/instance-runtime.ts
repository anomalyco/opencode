import { makeRuntime } from "@/effect/run-service"
import { type InstanceContext } from "./instance-context"
import { InstanceStore, type LoadInput } from "./instance-store"
import { Effect, Layer } from "effect"

// Production InstanceStore wiring plus a bridge for Promise/ALS callers that
// cannot yet yield InstanceStore.Service. This keeps InstanceStore itself
// low-level while still giving legacy Hono and CLI paths the production
// bootstrap implementation. Delete the Promise helpers once those callers are
// migrated to Effect boundaries that provide InstanceStore directly.
// Keep the bootstrap implementation import lazy: Instance is imported broadly,
// and importing the app bootstrap graph at module load can trigger ESM cycles.
export const layer = Layer.unwrap(
  Effect.promise(async () => {
    const { InstanceBootstrap } = await import("./bootstrap")
    return InstanceStore.defaultLayer.pipe(Layer.provide(InstanceBootstrap.defaultLayer))
  }),
)

const runtime = makeRuntime(InstanceStore.Service, layer)

export const load = (input: LoadInput) => runtime.runPromise((store) => store.load(input))
export const disposeInstance = (ctx: InstanceContext) => runtime.runPromise((store) => store.dispose(ctx))
export const disposeAllInstances = () => runtime.runPromise((store) => store.disposeAll())
export const reloadInstance = (input: LoadInput) => runtime.runPromise((store) => store.reload(input))

export * as InstanceRuntime from "./instance-runtime"
