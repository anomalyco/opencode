import { Layer, LayerMap } from "effect"
import { Location } from "./location"
import { Catalog } from "./catalog"
import { PluginBoot } from "./plugin/boot"
import { Policy } from "./policy"
import { Config } from "./config"

export class LocationServiceMap extends LayerMap.Service<LocationServiceMap>()("@opencode/example/LocationServiceMap", {
  lookup: (ref: Location.Ref) => {
    const result = Layer.mergeAll(Catalog.defaultLayer, PluginBoot.defaultLayer, Config.defaultLayer).pipe(
      Layer.provideMerge(Policy.defaultLayer),
      Layer.provideMerge(Location.defaultLayer(ref)),
    )
    return result
  },
  idleTimeToLive: "60 minutes",
  dependencies: [],
}) {}
