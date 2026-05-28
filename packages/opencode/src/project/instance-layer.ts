import { Effect, Layer } from "effect"
import { InstanceStore } from "./instance-store"

export const layer = Layer.unwrap(
  Effect.promise(async () => {
    const { InstanceBootstrap } = await import("./bootstrap")
    return InstanceStore.defaultLayer.pipe(Layer.provide(InstanceBootstrap.defaultLayer))
  }),
)

export * as InstanceLayer from "./instance-layer"
