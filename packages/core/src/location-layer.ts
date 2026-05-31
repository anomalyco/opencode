import { Layer, LayerMap } from "effect"
import { Location } from "./location"
import { Catalog } from "./catalog"
import { PluginBoot } from "./plugin/boot"
import { Config } from "./config"
import { AgentV2 } from "./agent"

export class LocationServiceMap extends LayerMap.Service<LocationServiceMap>()("@opencode/example/LocationServiceMap", {
  lookup: (ref: Location.Ref) => {
    const layer = Layer.mergeAll(
      Catalog.defaultLayer,
      PluginBoot.defaultLayer,
      Config.defaultLayer,
      AgentV2.defaultLayer,
    ).pipe(Layer.provideMerge(Location.defaultLayer(ref)))
    return Layer.fresh(layer)
  },
  idleTimeToLive: "60 minutes",
  dependencies: [],
}) {}
