import { Project } from "@opencode-ai/core/project"
import { Effect, Layer } from "effect"

export const globalProjectLayer = Layer.succeed(
  Project.Service,
  Project.Service.of({
    list: () => Effect.succeed([]),
    icons: () => Effect.succeed([]),
    update: () => Effect.die("not implemented"),
    resolve: (directory) => Effect.succeed({ id: Project.ID.global, directory, canonical: directory }),
  }),
)
