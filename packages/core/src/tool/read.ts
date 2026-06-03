export * as ReadTool from "./read"

import { Tool, ToolFailure } from "@opencode-ai/llm"
import { Cause, Effect, Layer, Schema } from "effect"
import { FileSystem } from "../filesystem"
import { NonNegativeInt, PositiveInt } from "../schema"
import { PermissionV2 } from "../permission"
import { ToolOutputStore } from "../tool-output-store"
import { ToolRegistry } from "../tool-registry"

export const name = "read"
const MAX_BYTES = 50 * 1024
const LocationInput = Schema.Struct({
  ...FileSystem.ReadInput.fields,
  offset: FileSystem.ListPageInput.fields.offset,
  limit: FileSystem.ListPageInput.fields.limit,
})
const ResourceInput = Schema.Struct({
  resource: Schema.String,
  offset: NonNegativeInt.pipe(Schema.optional),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(ToolOutputStore.MAX_READ_BYTES)).pipe(Schema.optional),
})
const Input = Schema.Union([LocationInput, ResourceInput])
const Success = Schema.Union([FileSystem.Content, FileSystem.ListPage, ToolOutputStore.Page])

const definition = Tool.make({
  description:
    "Read a text or binary file, list a directory page relative to the current location, or page through a managed tool-output resource by opaque URI.",
  parameters: Input,
  success: Success,
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const filesystem = yield* FileSystem.Service
    const resources = yield* ToolOutputStore.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        execute: ({ parameters, sessionID, assertPermission }) => {
          const input = parameters
          return Effect.gen(function* () {
            if ("resource" in input)
              return yield* resources.read({ sessionID, uri: input.resource, offset: input.offset, limit: input.limit })
            const resolved = yield* filesystem.resolveReadPath(input)
            if (resolved.type === "directory") {
              const { offset, limit } = input
              const target = resolved.target
              yield* assertPermission({ action: name, resources: [target.resource], save: ["*"] })
              const final = yield* filesystem.resolveReadPath(input)
              if (
                final.type !== "directory" ||
                final.target.resource !== target.resource ||
                final.target.real !== target.real
              )
                return yield* Effect.die(new Error("Directory changed after permission approval"))
              return yield* filesystem.listPageResolved(final.target, { offset, limit })
            }
            const target = resolved.target
            if (target.size > MAX_BYTES)
              return yield* Effect.die(new Error(`File exceeds ${MAX_BYTES} byte read limit`))
            yield* assertPermission({
              action: name,
              resources: [target.resource],
              save: ["*"],
            })
            const final = yield* filesystem.resolveReadPath(input)
            if (final.type !== "file" || final.target.resource !== target.resource || final.target.real !== target.real)
              return yield* Effect.die(new Error("File changed after permission approval"))
            if (final.target.size > MAX_BYTES)
              return yield* Effect.die(new Error(`File exceeds ${MAX_BYTES} byte read limit`))
            return yield* filesystem.readResolved(final.target, MAX_BYTES)
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.fail(
                new ToolFailure({
                  message: `Unable to read ${"resource" in input ? input.resource : input.path}`,
                  error: Cause.squash(cause),
                }),
              ),
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
  Layer.provideMerge(ToolOutputStore.defaultLayer),
)
