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
import { FileSystem } from "./filesystem"
import { Watcher } from "./filesystem/watcher"
import { ProjectReference } from "./project-reference"
import { RepositoryCache } from "./repository-cache"
import { Pty } from "./pty"
import { SkillV2 } from "./skill"
import { ListTool } from "./tool/list"
import { ToolRegistry } from "./tool-registry"
import { ReadTool } from "./tool/read"
import { SessionStore } from "./session/store"
import { LLMClient } from "@opencode-ai/llm"
import { RequestExecutor } from "@opencode-ai/llm/route"
import * as SessionRunnerLLM from "./session/runner/llm"
import { SessionRunnerModel } from "./session/runner/model"
import { SessionRunCoordinator } from "./session/run-coordinator"

export class LocationServiceMap extends LayerMap.Service<LocationServiceMap>()("@opencode/example/LocationServiceMap", {
  lookup: (ref: Location.Ref) => {
    const location = Location.layer(ref)
    const services = Layer.mergeAll(
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
      SkillV2.locationLayer,
      ToolRegistry.layer,
    ).pipe(Layer.provideMerge(location))
    const model = SessionRunnerModel.locationLayer.pipe(Layer.provide(services))
    const runner = SessionRunnerLLM.layer.pipe(Layer.provide(services), Layer.provide(model))
    const coordinator = SessionRunCoordinator.layer.pipe(Layer.provide(runner))
    return Layer.mergeAll(services, model, runner, coordinator, ReadTool.layer.pipe(Layer.provide(services))).pipe(
      Layer.fresh,
    )
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
    SessionStore.layer.pipe(Layer.provide(Database.defaultLayer)),
    PermissionSaved.defaultLayer,
    RepositoryCache.defaultLayer,
    LLMClient.layer.pipe(Layer.provide(RequestExecutor.defaultLayer)),
  ],
}) {}
