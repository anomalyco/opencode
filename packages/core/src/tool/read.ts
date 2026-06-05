export * as ReadTool from "./read"

import { Tool, ToolFailure } from "@opencode-ai/llm"
import { Cause, Effect, Layer, Schema } from "effect"
import { FileSystem } from "../filesystem"
import { NonNegativeInt, PositiveInt } from "../schema"
import { PermissionV2 } from "../permission"
import { ToolOutputStore } from "../tool-output-store"
import { ToolRegistry } from "./registry"

export const name = "read"
const LocationInput = Schema.Struct({
  ...FileSystem.ReadInput.fields,
  offset: FileSystem.ListPageInput.fields.offset.annotate({
    description: "The 1-based directory entry or text line offset to start reading from",
  }),
  limit: FileSystem.ListPageInput.fields.limit.annotate({
    description: "The maximum number of directory entries or text lines to read",
  }),
})
const ResourceInput = Schema.Struct({
  resource: Schema.String,
  offset: NonNegativeInt.pipe(Schema.optional),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(ToolOutputStore.MAX_READ_BYTES)).pipe(Schema.optional),
})
const Input = Schema.Union([LocationInput, ResourceInput])
const Success = Schema.Union([FileSystem.Content, FileSystem.TextPage, FileSystem.ListPage, ToolOutputStore.Page])

const definition = Tool.make({
  description:
    "Read a text or binary file, page through a large UTF-8 text file by line offset, list a directory page relative to the current location, or page through a managed tool-output resource by opaque URI.",
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
                return yield* new ToolFailure({
                  message: "Directory changed after permission approval. Please re-read and try again.",
                })
              return yield* filesystem.listPageResolved(final.target, { offset, limit })
            }
            const target = resolved.target
            yield* assertPermission({
              action: name,
              resources: [target.resource],
              save: ["*"],
            })
            const final = yield* filesystem.resolveReadPath(input)
            if (final.type !== "file" || final.target.resource !== target.resource || final.target.real !== target.real)
              return yield* new ToolFailure({
                message: "File changed after permission approval. Please re-read and try again.",
              })
            if (
              final.target.size > FileSystem.MAX_READ_BYTES ||
              input.offset !== undefined ||
              input.limit !== undefined
            )
              return yield* filesystem.readTextPageResolved(final.target, { offset: input.offset, limit: input.limit })
            return yield* filesystem.readResolved(final.target, FileSystem.MAX_READ_BYTES)
          }).pipe(
            Effect.catchCause((cause) => {
              const errors: unknown[] = []
              Cause.forEach(cause, (error) => errors.push(error))
              const messages = errors.map((e) => String(e)).join("\n")
              return Effect.fail(
                new ToolFailure({
                  message: `Unable to read ${"resource" in input ? input.resource : input.path}:\n${messages}`,
                }),
              )
            }),
          )
        },
      }),
    )
  }),
)
export const locationLayer = layer.pipe(
  Layer.provideMerge(ToolRegistry.defaultLayer),
  Layer.provideMerge(FileSystem.locationLayer),
  Layer.provideMerge(PermissionV2.locationLayer),
  Layer.provideMerge(ToolOutputStore.defaultLayer),
)
