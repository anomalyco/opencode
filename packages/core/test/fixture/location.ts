import { Location } from "@opencode-ai/core/location"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer } from "effect"
import { tmpdir } from "./tmpdir"

export function location(ref: Location.Ref, input: { projectDirectory?: AbsolutePath; vcs?: Project.Vcs } = {}) {
  const directory = input.projectDirectory ?? ref.directory
  return {
    directory: ref.directory,
    workspaceID: ref.workspaceID,
    project: { id: Project.ID.global, directory, canonical: directory },
    vcs: input.vcs,
  } satisfies Location.Interface
}

export const tempLocationLayer = Layer.unwrap(
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(
    Effect.map((tmp) => {
      const ref = Location.Ref.make({ directory: AbsolutePath.make(tmp.path) })
      return Layer.succeed(Location.Service, Location.Service.of(location(ref)))
    }),
  ),
)
