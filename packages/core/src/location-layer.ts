import { Layer, LayerMap } from "effect"
import { Location } from "./location"
import { Policy } from "./policy"
import { Config } from "./config"
import { PluginV2 } from "./plugin"
import { Catalog } from "./catalog"
import { AgentV2 } from "./agent"
import { PluginBoot } from "./plugin/boot"
import { Project } from "./project"
import { EventV2 } from "./event"
import { Auth } from "./auth"
import { Npm } from "./npm"
import { ModelsDev } from "./models-dev"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { Database } from "./database/database"
import { PermissionV2 } from "./permission"
import { PermissionSaved } from "./permission/saved"
import { SessionV2 } from "./session"
import { FileSystem } from "./filesystem"
import { Watcher } from "./filesystem/watcher"
import { ProjectReference } from "./project-reference"
import { RepositoryCache } from "./repository-cache"
import { Pty } from "./pty"

export class LocationServiceMap extends LayerMap.Service<LocationServiceMap>()("@opencode/example/LocationServiceMap", {
  lookup: (ref: Location.Ref) => {
    const location = Location.layer(ref)
    return Layer.mergeAll(
      location,
      Policy.locationLayer,
      Config.locationLayer,
      ProjectReference.locationLayer,
      PluginV2.locationLayer,
      Catalog.locationLayer,
      AgentV2.locationLayer,
      PluginBoot.locationLayer,
      PermissionV2.locationLayer,
      FileSystem.locationLayer,
      Watcher.locationLayer,
      Pty.locationLayer,
    ).pipe(Layer.provideMerge(location), Layer.fresh)
  },
  idleTimeToLive: "60 minutes",
  dependencies: [
    Project.defaultLayer,
    EventV2.defaultLayer,
    Auth.defaultLayer,
    Npm.defaultLayer,
    ModelsDev.defaultLayer,
    FSUtil.defaultLayer,
    Global.defaultLayer,
    Database.defaultLayer,
    SessionV2.defaultLayer,
    PermissionSaved.defaultLayer,
    RepositoryCache.defaultLayer,
  ],
}) {}
