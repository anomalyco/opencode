export * as ReadTool from "./read"

import { Tool, ToolFailure } from "@opencode-ai/llm"
import { Cause, Effect, Layer, Schema } from "effect"
import { FileSystem } from "../filesystem"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "../tool-registry"

export const name = "read"
const MAX_BYTES = 50 * 1024
const Input = Schema.Struct({
  ...FileSystem.ReadInput.fields,
  offset: FileSystem.ListPageInput.fields.offset,
  limit: FileSystem.ListPageInput.fields.limit,
})
const Success = Schema.Union([FileSystem.Content, FileSystem.ListPage])

const definition = Tool.make({
  description: "Read a text or binary file, or list a directory page, relative to the current location.",
  parameters: Input,
  success: Success,
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
            const resolved = yield* filesystem.resolveReadPath(input)
            if (resolved.type === "directory") {
              const { offset, limit } = input
              const target = resolved.target
              yield* permission.assert({ sessionID, action: name, resources: [target.resource], save: ["*"] })
              const final = yield* filesystem.resolveReadPath(input)
              if (final.type !== "directory" || final.target.resource !== target.resource || final.target.real !== target.real)
                return yield* Effect.die(new Error("Directory changed after permission approval"))
              return yield* filesystem.listPageResolved(final.target, { offset, limit })
            }
            const target = resolved.target
            if (target.size > MAX_BYTES)
              return yield* Effect.die(new Error(`File exceeds ${MAX_BYTES} byte read limit`))
            yield* permission.assert({
              sessionID,
              action: name,
              resources: [target.resource],
              save: ["*"],
            })
            const final = yield* filesystem.resolveReadPath(input)
            if (final.type !== "file" || final.target.resource !== target.resource || final.target.real !== target.real)
              return yield* Effect.die(new Error("File changed after permission approval"))
            if (final.target.size > MAX_BYTES) return yield* Effect.die(new Error(`File exceeds ${MAX_BYTES} byte read limit`))
            return yield* filesystem.readResolved(final.target, MAX_BYTES)
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
