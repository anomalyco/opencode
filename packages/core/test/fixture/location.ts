import type { Instance } from "@opencode-ai/core/instance"
import { Location } from "@opencode-ai/core/location"
import { InstanceMap } from "@opencode-ai/core/instance-map"
import { Entry, fromMap } from "@opencode-ai/core/instance-map/internal"
import type { LocationServices } from "@opencode-ai/core/location-services"
import { Project } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer, LayerMap } from "effect"
import { tmpdir } from "./tmpdir"

/**
 * Builds isolated services per key using the real map and location policy.
 * Only provided services are widened; required dependencies remain typed.
 */
export function stubLocations<A, R>(services: Layer.Layer<A, Instance.Error, R>) {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const layer = services as unknown as Layer.Layer<LocationServices, Instance.Error, R>
  return Layer.effect(
    InstanceMap.Service,
    Effect.map(
      LayerMap.make((_: Entry) => Layer.fresh(layer)),
      fromMap,
    ),
  )
}

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
