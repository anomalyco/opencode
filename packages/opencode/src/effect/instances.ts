import { Effect, Layer, LayerMap, ServiceMap } from "effect"
import { FileService } from "@/file"
import { FileTimeService } from "@/file/time"
import { FileWatcherService } from "@/file/watcher"
import { FormatService } from "@/format"
import { PermissionEffect } from "@/permission/service"
import { Instance } from "@/project/instance"
import { VcsService } from "@/project/vcs"
import { ProviderAuthService } from "@/provider/auth-service"
import { QuestionService } from "@/question/service"
import { SkillService } from "@/skill/skill"
import { SnapshotService } from "@/snapshot"
import { InstanceContext } from "./instance-context"
import { registerDisposer } from "./instance-registry"

export { InstanceContext } from "./instance-context"

export type InstanceServices =
  | QuestionService
  | PermissionEffect.Service
  | ProviderAuthService
  | FileWatcherService
  | VcsService
  | FileTimeService
  | FormatService
  | FileService
  | SkillService
  | SnapshotService

// NOTE: LayerMap only passes the key (directory string) to lookup, but we need
// the full instance context (directory, worktree, project). We read from the
// legacy Instance ALS here, which is safe because lookup is only triggered via
// runPromiseInstance -> Instances.get, which always runs inside Instance.provide.
// This should go away once the old Instance type is removed and lookup can load
// the full context directly.
function lookup(_key: string) {
  const ctx = Layer.sync(InstanceContext, () => InstanceContext.of(Instance.current))
  return Layer.mergeAll(
    Layer.fresh(QuestionService.layer),
    Layer.fresh(PermissionEffect.layer),
    Layer.fresh(ProviderAuthService.layer),
    Layer.fresh(FileWatcherService.layer).pipe(Layer.orDie),
    Layer.fresh(VcsService.layer),
    Layer.fresh(FileTimeService.layer).pipe(Layer.orDie),
    Layer.fresh(FormatService.layer),
    Layer.fresh(FileService.layer),
    Layer.fresh(SkillService.layer),
    Layer.fresh(SnapshotService.layer),
  ).pipe(Layer.provide(ctx))
}

export class Instances extends ServiceMap.Service<Instances, LayerMap.LayerMap<string, InstanceServices>>()(
  "opencode/Instances",
) {
  static readonly layer = Layer.effect(
    Instances,
    Effect.gen(function* () {
      const layerMap = yield* LayerMap.make(lookup, {
        idleTimeToLive: Infinity,
      })
      const unregister = registerDisposer((directory) => Effect.runPromise(layerMap.invalidate(directory)))
      yield* Effect.addFinalizer(() => Effect.sync(unregister))
      return Instances.of(layerMap)
    }),
  )

  static get(directory: string): Layer.Layer<InstanceServices, never, Instances> {
    return Layer.unwrap(Instances.use((map) => Effect.succeed(map.get(directory))))
  }
}
