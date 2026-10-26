import { Effect, Layer, PlatformError } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"

/** Counts process spawns; `fail` rejects matching spawns with a transient error. */
export function countingSpawner(fail?: (args: readonly string[]) => boolean) {
  const state = { spawns: 0 }
  const node = CrossSpawnSpawner.node.replace(
    CrossSpawnSpawner.node.mapLayer((base) =>
      Layer.effect(
        ChildProcessSpawner.ChildProcessSpawner,
        Effect.map(ChildProcessSpawner.ChildProcessSpawner, (spawner) =>
          ChildProcessSpawner.make((command) => {
            state.spawns++
            if (fail && command._tag === "StandardCommand" && fail(command.args))
              return Effect.fail(PlatformError.systemError({ _tag: "Busy", module: "ChildProcess", method: "spawn" }))
            return spawner.spawn(command)
          }),
        ),
      ).pipe(Layer.provide(base)),
    ),
  )
  return { node, spawns: () => state.spawns }
}
