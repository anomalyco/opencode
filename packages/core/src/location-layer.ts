import { Layer, LayerMap } from "effect"
import { Location } from "./location"
import { Catalog } from "./catalog"
import { PluginBoot } from "./plugin/boot"

export class LocationServiceMap extends LayerMap.Service<LocationServiceMap>()("@opencode/example/LocationServiceMap", {
  lookup: (ref: Location.Ref) => {
    const location = Layer.succeed(Location.Service, Location.Service.of(ref))
    return Layer.mergeAll(Catalog.defaultLayer, PluginBoot.defaultLayer).pipe(Layer.provide(location))
  },
  idleTimeToLive: "5 minutes",
}) {}
