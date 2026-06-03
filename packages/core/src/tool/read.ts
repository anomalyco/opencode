export * as ReadTool from "./read"

import { Tool, ToolFailure } from "@opencode-ai/llm"
import { Cause, Effect, Layer } from "effect"
import { FileSystem } from "../filesystem"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "../tool-registry"

export const name = "read"
const MAX_BYTES = 50 * 1024

const definition = Tool.make({
  description: "Read a text or binary file relative to the current location.",
  parameters: FileSystem.ReadInput,
  success: FileSystem.Content,
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const filesystem = yield* FileSystem.Service
    const permission = yield* PermissionV2.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        execute: ({ parameters, sessionID }) => {
          const input = parameters
          return Effect.gen(function* () {
            const target = yield* filesystem.resolveRead(input)
            if (target.size > MAX_BYTES)
              return yield* Effect.die(new Error(`File exceeds ${MAX_BYTES} byte read limit`))
            yield* permission.assert({
              sessionID,
              action: name,
              resources: [target.resource],
              save: ["*"],
            })
            const final = yield* filesystem.resolveRead(input)
            if (final.resource !== target.resource || final.real !== target.real)
              return yield* Effect.die(new Error("File changed after permission approval"))
            if (final.size > MAX_BYTES) return yield* Effect.die(new Error(`File exceeds ${MAX_BYTES} byte read limit`))
            return yield* filesystem.readResolved(final, MAX_BYTES)
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.fail(new ToolFailure({ message: `Unable to read ${input.path}`, error: Cause.squash(cause) })),
            ),
          )
        },
      }),
    )
  }),
)
export const locationLayer = layer.pipe(
  Layer.provideMerge(ToolRegistry.layer),
  Layer.provideMerge(FileSystem.locationLayer),
  Layer.provideMerge(PermissionV2.locationLayer),
)
