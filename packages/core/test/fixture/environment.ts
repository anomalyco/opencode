import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Environment } from "@opencode-ai/core/environment/index"
import { Location } from "@opencode-ai/core/location"
import { CrossSpawnSpawner } from "@opencode-ai/util/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Effect, Layer } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

/**
 * The host environment, without the workspace machinery: what a location with no `workspaceID`
 * resolves to.
 */
export const hostEnvironmentLayer = Layer.effect(
  Environment.Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const driver = Environment.makeLocalDriver(spawner)
    return Environment.Service.of({ files: Environment.makeFiles(driver), spawner: driver.spawner })
  }),
).pipe(Layer.provide(LayerNode.compile(CrossSpawnSpawner.node)))

/**
 * The host environment with its spawner wrapped so a test can assert on every command that crosses
 * the seam. Spawning still really happens, so the process under test behaves normally.
 */
export const recordingEnvironmentLayer = (spawns: Array<ChildProcess.Command>) =>
  Layer.effect(
    Environment.Service,
    Effect.gen(function* () {
      const environment = yield* Environment.Service
      return Environment.Service.of({
        ...environment,
        spawner: ChildProcessSpawner.make((command) => {
          spawns.push(command)
          return environment.spawner.spawn(command)
        }),
      })
    }),
  ).pipe(Layer.provide(hostEnvironmentLayer))

export type EnvironmentFilesTransform = (files: Environment.Files) => Partial<Environment.Files>

export function transformEnvironmentFiles(
  location: Layer.Layer<Location.Service>,
  transform: EnvironmentFilesTransform = () => ({}),
) {
  return Layer.effect(
    Environment.Service,
    Effect.gen(function* () {
      const current = yield* Environment.Service
      return Environment.Service.of({
        ...current,
        files: { ...current.files, ...transform(current.files) },
      })
    }),
  ).pipe(Layer.provide(AppNodeBuilder.build(Environment.node, [[Location.node, location]])))
}
