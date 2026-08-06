import path from "path"
import { Context, Effect, Layer } from "effect"
import { Info, Ref, response } from "@opencode-ai/schema/location"
import { Workspace } from "@opencode-ai/schema/workspace"
import { Project } from "./project"
import { WorkspaceEnvironment } from "./workspace/environment"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { makeLocationNode, tags } from "@opencode-ai/util/effect/app-node"

export * as Location from "./location"

export { Info, Ref, response }

export interface Interface extends Info {
  readonly vcs?: Project.Vcs
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Location") {}

/**
 * Path rules for a Location's directory. Hosted directories live in the
 * provider filesystem: posix semantics regardless of the host platform.
 */
export const paths = (location: Pick<Info, "workspaceID">) => (location.workspaceID ? path.posix : path)

export const node = LayerNode.unbound(Service, tags.values.location)

const layer = (ref: Ref) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const project = yield* Project.Service
      const resolved = yield* project.resolve(ref.directory)
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
    deps: [Project.node],
  })

/**
 * Hosted Locations state their Project instead of discovering it: host git
 * and filesystem walks must never run against a provider directory. The
 * Workspace root comes from the already-connected environment, avoiding a
 * second workspace row read per graph build.
 */
export const hostedBoundNode = (ref: Ref, workspaceID: Workspace.ID) =>
  makeLocationNode({
    service: Service,
    layer: Layer.effect(
      Service,
      Effect.gen(function* () {
        const env = yield* WorkspaceEnvironment.Service
        return Service.of({
          directory: ref.directory,
          workspaceID,
          project: Project.hostedGlobal(env.directory),
        })
      }),
    ),
    deps: [WorkspaceEnvironment.node],
  })
