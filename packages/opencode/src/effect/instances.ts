import { Effect, Layer, LayerMap, ServiceMap } from "effect"
import { registerDisposer } from "./instance-registry"
import { InstanceContext } from "./instance-context"
import { ProviderAuthService } from "@/provider/auth-service"
import { QuestionService } from "@/question/service"
import { PermissionService } from "@/permission/service"
import { FileWatcherService } from "@/file/watcher"
import { VcsService } from "@/project/vcs"
import { FileTimeService } from "@/file/time"
import { FormatService } from "@/format"
import { FileService } from "@/file"
import { SkillService } from "@/skill/skill"
import { Instance } from "@/project/instance"

export { InstanceContext } from "./instance-context"

export type InstanceServices =
  | QuestionService
  | PermissionService
  | ProviderAuthService
  | FileWatcherService
  | VcsService
  | FileTimeService
  | FormatService
  | FileService
  | SkillService

function lookup(directory: string) {
  const project = Instance.project
  const ctx = Layer.sync(InstanceContext, () => InstanceContext.of({ directory, project }))
  return Layer.mergeAll(
    Layer.fresh(QuestionService.layer),
    Layer.fresh(PermissionService.layer),
    Layer.fresh(ProviderAuthService.layer),
    Layer.fresh(FileWatcherService.layer).pipe(Layer.orDie),
    Layer.fresh(VcsService.layer),
    Layer.fresh(FileTimeService.layer).pipe(Layer.orDie),
    Layer.fresh(FormatService.layer),
    Layer.fresh(FileService.layer),
    Layer.fresh(SkillService.layer),
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
