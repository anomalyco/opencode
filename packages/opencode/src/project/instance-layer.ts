import { Layer } from "effect"
import { InstanceBootstrap } from "./bootstrap"
import { InstanceStore } from "./instance-store"

export const layer = InstanceStore.defaultLayer.pipe(Layer.provide(InstanceBootstrap.defaultLayer))

export * as InstanceLayer from "./instance-layer"
