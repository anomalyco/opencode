import { Effect, Layer, LayerMap, ServiceMap } from "effect"
import { registerDisposer } from "./instance-registry"
import { ProviderAuthService } from "@/provider/auth-service"
import { QuestionService } from "@/question/service"
import { PermissionService } from "@/permission/service"
import { FileWatcherService } from "@/file/watcher"
import { Instance } from "@/project/instance"
import type { Project } from "@/project/project"

export declare namespace InstanceContext {
  export interface Shape {
    readonly directory: string
    readonly project: Project.Info
  }
}

export class InstanceContext extends ServiceMap.Service<InstanceContext, InstanceContext.Shape>()(
  "opencode/InstanceContext",
) {}

export type InstanceServices = QuestionService | PermissionService | ProviderAuthService | FileWatcherService

function lookup(directory: string) {
  const project = Instance.project
  const ctx = Layer.sync(InstanceContext, () => InstanceContext.of({ directory, project }))
  return Layer.mergeAll(
    Layer.fresh(QuestionService.layer),
    Layer.fresh(PermissionService.layer),
    Layer.fresh(ProviderAuthService.layer),
    Layer.fresh(FileWatcherService.layer),
  ).pipe(Layer.provide(ctx))
}

export class Instances extends ServiceMap.Service<Instances, LayerMap.LayerMap<string, InstanceServices>>()(
  "opencode/Instances",
) {
  static readonly layer = Layer.effect(
    Instances,
    Effect.gen(function* () {
      const layerMap = yield* LayerMap.make(lookup, { idleTimeToLive: Infinity })
      const unregister = registerDisposer((directory) => Effect.runPromise(layerMap.invalidate(directory)))
      yield* Effect.addFinalizer(() => Effect.sync(unregister))
      return Instances.of(layerMap)
    }),
  )

  static get(directory: string): Layer.Layer<InstanceServices, never, Instances> {
    return Layer.unwrap(Instances.use((map) => Effect.succeed(map.get(directory))))
  }

  static invalidate(directory: string): Effect.Effect<void, never, Instances> {
    return Instances.use((map) => map.invalidate(directory))
  }
}
