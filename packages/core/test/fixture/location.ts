import type { Instance } from "@opencode/core/instance"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Effect, Layer, type LayerMap, RcMap } from "effect"
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

/** Hand-built Location maps do not track starts, so they report every cached Location as running. */
export function readyWhenCached<R>(
  make: Effect.Effect<LayerMap.LayerMap<Location.Ref, Instance.Services, Instance.Error>, never, R>,
) {
  return Effect.map(make, (map) => LocationServiceMap.Service.of({ ...map, ready: (ref) => RcMap.has(map.rcMap, ref) }))
}
