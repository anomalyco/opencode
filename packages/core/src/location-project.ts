export * as LocationProject from "./location-project.js"

import { Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FileSystem } from "./filesystem.js"
import { Location } from "./location.js"
import { Project } from "./project.js"

// Location resolves its Project without saving it. Saving it and recording activity waits for FileSystem to accept
// the directory, so requests for a folder that no longer exists leave the Project list alone. Profiles whose
// FileSystem does not check the host, like workerd, still save the Project.
export const node = makeLocationNode({
  name: "location-project",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const location = yield* Location.Service
      const project = yield* Project.Service
      yield* project.resolve(location.directory)
      yield* project.activate(location.project.id)
    }),
  ),
  deps: [Location.node, Project.node, FileSystem.node],
})
