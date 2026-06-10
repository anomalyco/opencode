import { Layer, LayerMap } from "effect"
import { Location } from "./location"
import { Policy } from "./policy"
import { Config } from "./config"
import { PluginV2 } from "./plugin"
import { Catalog } from "./catalog"
import { CommandV2 } from "./command"
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
import { Ripgrep } from "./ripgrep"
import { Watcher } from "./filesystem/watcher"
import { LocationMutation } from "./location-mutation"
import { FileMutation } from "./file-mutation"
import { Reference } from "./reference"
import { RepositoryCache } from "./repository-cache"
import { Pty } from "./pty"
import { SkillV2 } from "./skill"
import { SkillGuidance } from "./skill/guidance"
import { BuiltInTools } from "./tool/builtins"
import { Image } from "./image"
import { ToolRegistry } from "./tool/registry"
import { ApplicationTools } from "./tool/application-tools"
import { ToolOutputStore } from "./tool-output-store"
import { AppProcess } from "./process"
import { SessionStore } from "./session/store"
import { SessionTodo } from "./session/todo"
import { QuestionV2 } from "./question"
import { LLMClient } from "@opencode-ai/llm"
import { RequestExecutor } from "@opencode-ai/llm/route"
import * as SessionRunnerLLM from "./session/runner/llm"
import { SessionRunnerModel } from "./session/runner/model"
import { SystemContextBuiltIns } from "./system-context/builtins"
import { FetchHttpClient } from "effect/unstable/http"

export class LocationServiceMap extends LayerMap.Service<LocationServiceMap>()("@opencode/example/LocationServiceMap", {
  lookup: (ref: Location.Ref) => {
    const location = Location.layer(ref)
    const systemContext = SystemContextBuiltIns.locationLayer
    const base = Layer.mergeAll(
      location,
      Policy.locationLayer,
      Config.locationLayer,
      Reference.locationLayer,
      PluginV2.locationLayer,
      Catalog.locationLayer,
      CommandV2.locationLayer,
      AgentV2.locationLayer,
      PluginBoot.locationLayer,
      FileSystem.locationLayer,
      Watcher.locationLayer,
      Pty.locationLayer,
      SkillV2.locationLayer,
      systemContext,
      LocationMutation.locationLayer.pipe(Layer.orDie),
    ).pipe(Layer.provideMerge(location))
    const resources = ToolOutputStore.layer.pipe(Layer.provide(base))
    const permissionsAndTools = ToolRegistry.layer.pipe(
      Layer.provideMerge(PermissionV2.locationLayer),
      Layer.provide(resources),
      Layer.provide(base),
    )
    const services = Layer.mergeAll(base, resources, permissionsAndTools)
    const image = Image.layer.pipe(Layer.provide(services))
    const mutation = FileMutation.locationLayer.pipe(Layer.provide(services))
    const skillGuidance = SkillGuidance.locationLayer.pipe(Layer.provide(services))
    const todos = SessionTodo.layer.pipe(Layer.provide(services))
    const questions = QuestionV2.locationLayer.pipe(Layer.provide(services))
    const builtInTools = BuiltInTools.locationLayer.pipe(
      Layer.provide(services),
      Layer.provide(mutation),
      Layer.provide(resources),
      Layer.provide(todos),
      Layer.provide(questions),
      Layer.provide(image),
    )
    const model = SessionRunnerModel.locationLayer.pipe(Layer.provide(services))
    const runner = SessionRunnerLLM.defaultLayer.pipe(
      Layer.provide(services),
      Layer.provide(model),
      Layer.provide(skillGuidance),
    )
    return Layer.mergeAll(services, image, mutation, resources, todos, questions, model, runner, builtInTools).pipe(
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
    AppProcess.defaultLayer,
    Global.defaultLayer,
    Ripgrep.defaultLayer,
    Database.defaultLayer,
    SessionStore.layer.pipe(Layer.provide(Database.defaultLayer)),
    PermissionSaved.defaultLayer,
    RepositoryCache.defaultLayer,
    LLMClient.layer.pipe(Layer.provide(RequestExecutor.defaultLayer)),
    FetchHttpClient.layer,
    ToolOutputStore.defaultCleanupLayer,
    ApplicationTools.layer,
  ],
}) {}
