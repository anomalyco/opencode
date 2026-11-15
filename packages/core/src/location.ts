import { Context, Effect, Layer } from "effect"
import { Info, Ref, response } from "@opencode/schema/location"
import { FSUtil } from "@opencode/util/fs-util"
import { Project } from "./project.js"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode, tags } from "@opencode/util/effect/app-node"

export * as Location from "./location.js"

export { Info, Ref, response }

export interface Interface extends Info {
  readonly vcs?: Project.Vcs
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Location") {}

export const node = LayerNode.unbound(Service, tags.values.location)

const layer = (ref: Ref) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const project = yield* Project.Service
      // Location.node builds alongside FileSystem.node, so avoid creating or unarchiving
      // a Project row for a local path that FileSystem.node is about to reject.
      const persist = ref.workspaceID !== undefined || (yield* fs.isDir(ref.directory))
      const resolved = yield* project.resolve(ref.directory, { persist })
      return Service.of({
        directory: ref.directory,
        workspaceID: ref.workspaceID,
        project: { id: resolved.id, directory: resolved.directory, canonical: resolved.canonical },
        vcs: resolved.vcs,
      })
    }),
  )

export const boundNode = (ref: Ref) =>
  makeLocationNode({
    service: Service,
    layer: layer(ref),
    deps: [FSUtil.node, Project.node],
  })
