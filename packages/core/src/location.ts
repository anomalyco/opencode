import { Context, Effect, Layer } from "effect"
import { Info, Ref, response } from "@opencode-ai/schema/location"
import { Project } from "./project.js"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { makeLocationNode, tags } from "@opencode-ai/util/effect/app-node"

export * as Location from "./location.js"

export { Info, Ref, response }

export interface Interface extends Info {
  readonly vcs?: Project.Vcs
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Location") {}

export const node = LayerNode.unbound(Service, tags.values.location)

const layer = (ref: Ref, options?: { readonly discovery?: boolean }) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const project = yield* Project.Service
      const resolved = yield* project.resolve(ref.directory, options)
      return Service.of({
        directory: ref.directory,
        workspaceID: ref.workspaceID,
        project: { id: resolved.id, directory: resolved.directory, canonical: resolved.canonical },
        vcs: resolved.vcs,
      })
    }),
  )

export const boundNode = (ref: Ref, options?: { readonly discovery?: boolean }) =>
  makeLocationNode({
    service: Service,
    layer: layer(ref, options),
    deps: [Project.node],
  })
