import { Effect, Layer, LayerMap, ServiceMap } from "effect"
import { File } from "@/file/service"
import { FileTime } from "@/file/time-service"
import { FileWatcher } from "@/file/watcher"
import { Format } from "@/format/service"
import { Permission } from "@/permission/service"
import { Instance } from "@/project/instance"
import { Vcs } from "@/project/vcs"
import { ProviderAuth } from "@/provider/auth-service"
import { Question } from "@/question/service"
import { Skill } from "@/skill/service"
import { Snapshot } from "@/snapshot/service"
import { InstanceContext } from "./instance-context"
import { registerDisposer } from "./instance-registry"

export { InstanceContext } from "./instance-context"

export type InstanceServices =
  | Question.Service
  | Permission.Service
  | ProviderAuth.Service
  | FileWatcher.Service
  | Vcs.Service
  | FileTime.Service
  | Format.Service
  | File.Service
  | Skill.Service
  | Snapshot.Service

// NOTE: LayerMap only passes the key (directory string) to lookup, but we need
// the full instance context (directory, worktree, project). We read from the
// legacy Instance ALS here, which is safe because lookup is only triggered via
// runPromiseInstance -> Instances.get, which always runs inside Instance.provide.
// This should go away once the old Instance type is removed and lookup can load
// the full context directly.
function lookup(_key: string) {
  const ctx = Layer.sync(InstanceContext, () => InstanceContext.of(Instance.current))
  return Layer.mergeAll(
    Question.layer,
    Permission.layer,
    ProviderAuth.defaultLayer,
    FileWatcher.layer,
    Vcs.layer,
    FileTime.layer,
    Format.layer,
    File.layer,
    Skill.defaultLayer,
    Snapshot.defaultLayer,
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
}
