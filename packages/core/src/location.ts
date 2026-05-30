import { Context, Effect, Layer, Schema } from "effect"
import { Project } from "./project"
import { AbsolutePath } from "./schema"

export * as Location from "./location"

export const Ref = Schema.Struct({
  directory: AbsolutePath,
  workspaceID: Schema.optional(Schema.String),
}).annotate({ identifier: "Location.Ref" })
export type Ref = typeof Ref.Type

export interface Interface {
  readonly directory: AbsolutePath
  readonly workspaceID?: string
  readonly project: {
    readonly id: Project.ID
    readonly directory: AbsolutePath
  }
  readonly vcs?: Project.Vcs
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Location") {}

export const layer = (ref: Ref) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const project = yield* Project.Service
      const resolved = yield* project.resolve(ref.directory)
      return Service.of({
        directory: ref.directory,
        workspaceID: ref.workspaceID,
        project: { id: resolved.id, directory: resolved.directory },
        vcs: resolved.vcs,
      })
    }),
  )

export const defaultLayer = (ref: Ref) => layer(ref).pipe(Layer.provide(Project.defaultLayer))
