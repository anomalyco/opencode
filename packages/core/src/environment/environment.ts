import { CrossSpawnSpawner } from "@opencode-ai/util/cross-spawn-spawner"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import type { Files } from "./files"
import { makeFiles } from "./index"
import { makeLocalDriver } from "./local"

export interface Interface {
  readonly files: Files
  readonly spawner: ChildProcessSpawner["Service"]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Environment") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    return Service.of({ files: makeFiles(makeLocalDriver(spawner)), spawner })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [CrossSpawnSpawner.node] })

export * as EnvironmentService from "./environment"
