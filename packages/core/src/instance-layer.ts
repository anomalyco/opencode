import { Layer, LayerMap } from "effect"
import { Instance } from "./instance"
import { Catalog } from "./catalog"
import { PluginBoot } from "./plugin/boot"

export class InstanceServiceMap extends LayerMap.Service<InstanceServiceMap>()("@opencode/example/InstanceServiceMap", {
  lookup: (ref: Instance.Ref) => {
    const instance = Layer.succeed(Instance.Service, Instance.Service.of(ref))
    return Layer.mergeAll(Catalog.defaultLayer, PluginBoot.defaultLayer).pipe(Layer.provide(instance))
  },
  idleTimeToLive: "5 minutes",
}) {}
