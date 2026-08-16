import { Effect, Layer, PlatformError } from "effect"
import { ChildProcessSpawner, make } from "effect/unstable/process/ChildProcessSpawner"

export const spawner = make(() =>
  Effect.fail(
    PlatformError.systemError({
      _tag: "Unknown",
      module: "Environment",
      method: "spawn",
      description: "This location has no execution plane: no workspace is attached and the host cannot spawn processes",
    }),
  ),
)

export const layer = Layer.succeed(ChildProcessSpawner, spawner)

export * as EnvironmentUnavailable from "./unavailable.js"
