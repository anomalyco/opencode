import { Context, Effect, Layer } from "effect"
import path from "path"
import { Info, Ref, response } from "@opencode-ai/schema/location"
import { InstanceKey } from "./instance-key.js"
import { AbsolutePath } from "@opencode-ai/schema/schema"
import { Project } from "./project.js"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { makeLocationNode, tags } from "@opencode-ai/util/effect/app-node"

export * as Location from "./location.js"

export { Info, Ref, response }

export function canonical(ref: Ref): Ref {
  return Ref.make({
    directory: AbsolutePath.make(process.platform === "win32" ? path.normalize(ref.directory) : ref.directory),
    ...(ref.workspaceID === undefined ? {} : { workspaceID: ref.workspaceID }),
  })
}

/** The default assignment shares one instance per canonical location. No inverse is required. */
export function instanceKey(ref: Ref): InstanceKey.Key {
  return InstanceKey.Key(
    JSON.stringify([
      process.platform === "win32" ? path.normalize(ref.directory) : ref.directory,
      ref.workspaceID ?? null,
    ]),
  )
}

export interface Interface extends Info {
  readonly vcs?: Project.Vcs
  readonly vcsBackend?: string
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
        vcsBackend: resolved.vcsBackend,
      })
    }),
  )

export const boundNode = (ref: Ref, options?: { readonly discovery?: boolean }) =>
  makeLocationNode({
    service: Service,
    layer: layer(ref, options),
    deps: [Project.node],
  })
