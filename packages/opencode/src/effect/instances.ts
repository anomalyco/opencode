import { Effect, Exit, Fiber, Layer, LayerMap, MutableHashMap, Scope, ServiceMap } from "effect"
import { Bus } from "@/bus"
import { File } from "@/file"
import { FileTime } from "@/file/time"
import { FileWatcher } from "@/file/watcher"
import { Format } from "@/format"
import { PermissionNext } from "@/permission"
import { Instance } from "@/project/instance"
import { Vcs } from "@/project/vcs"
import { ProviderAuth } from "@/provider/auth"
import { Question } from "@/question"
import { Skill } from "@/skill/skill"
import { Snapshot } from "@/snapshot"
import { InstanceContext } from "./instance-context"
import { registerDisposer } from "./instance-registry"

export { InstanceContext } from "./instance-context"

export type InstanceServices =
  | Bus.Service
  | Question.Service
  | PermissionNext.Service
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
    Layer.fresh(Bus.layer),
    Layer.fresh(Question.layer),
    Layer.fresh(PermissionNext.layer),
    Layer.fresh(ProviderAuth.defaultLayer),
    Layer.fresh(FileWatcher.layer).pipe(Layer.orDie),
    Layer.fresh(Vcs.layer),
    Layer.fresh(FileTime.layer).pipe(Layer.orDie),
    Layer.fresh(Format.layer),
    Layer.fresh(File.layer),
    Layer.fresh(Skill.defaultLayer),
    Layer.fresh(Snapshot.defaultLayer),
  ).pipe(Layer.provide(ctx))
}

export class Instances extends ServiceMap.Service<Instances, LayerMap.LayerMap<string, InstanceServices>>()(
  "opencode/Instances",
) {
  static readonly layer = Layer.effect(
    Instances,
    Effect.gen(function* () {
      const layerMap = yield* LayerMap.make(lookup, { idleTimeToLive: Infinity })

      // Force-invalidate closes the RcMap entry scope even when refCount > 0.
      // Standard RcMap.invalidate bails in that case, leaving long-running
      // consumer fibers orphaned. This is an upstream issue:
      // https://github.com/Effect-TS/effect-smol/pull/1799
      const forceInvalidate = (directory: string) =>
        Effect.gen(function* () {
          const rcMap = layerMap.rcMap
          if (rcMap.state._tag === "Closed") return
          const entry = MutableHashMap.get(rcMap.state.map, directory)
          if (entry._tag === "None") return
          MutableHashMap.remove(rcMap.state.map, directory)
          if (entry.value.fiber) yield* Fiber.interrupt(entry.value.fiber)
          yield* Scope.close(entry.value.scope, Exit.void)
        }).pipe(Effect.uninterruptible, Effect.ignore)

      const unregister = registerDisposer((directory) => Effect.runPromise(forceInvalidate(directory)))
      yield* Effect.addFinalizer(() => Effect.sync(unregister))
      return Instances.of(layerMap)
    }),
  )

  static get(directory: string): Layer.Layer<InstanceServices, never, Instances> {
    return Layer.unwrap(Instances.use((map) => Effect.succeed(map.get(directory))))
  }
}
