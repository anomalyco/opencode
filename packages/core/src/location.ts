import { Effect, Layer } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { FSUtil } from "@opencode/util/fs-util"
import { EnvironmentUnavailable } from "./environment/unavailable.js"
import { Project } from "./project.js"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode, tags } from "@opencode/util/effect/app-node"
import { Info, Ref, response, Service, type Interface } from "./location/service.js"

export * as Location from "./location.js"

export { Info, Ref, response, Service, type Interface }

export const node = LayerNode.unbound(Service, tags.values.location)

const layer = (ref: Ref) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const project = yield* Project.Service
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const local = ref.workspaceID === undefined && spawner !== EnvironmentUnavailable.spawner
      // Location.node builds alongside FileSystem.node, so avoid creating or unarchiving
      // a Project row for a local path that FileSystem.node is about to reject.
      const persist = ref.workspaceID !== undefined || (local && (yield* fs.isDir(ref.directory)))
      const resolved = yield* project.resolve(ref.directory, { persist, local })
      return Service.of({
        directory: ref.directory,
        workspaceID: ref.workspaceID,
        project: { id: resolved.id, directory: resolved.directory, canonical: resolved.canonical },
        vcs: resolved.vcs,
      })
    }),
  )

// What every bound Location stands on, whatever its directory.
export const dependencies = [CrossSpawnSpawner.node, FSUtil.node, Project.node] as const

export const boundNode = (ref: Ref) =>
  makeLocationNode({
    service: Service,
    layer: layer(ref),
    deps: dependencies,
  })
