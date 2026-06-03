export * as ListTool from "./list"

import { Tool, ToolFailure } from "@opencode-ai/llm"
import { Cause, Effect, Layer } from "effect"
import { FileSystem } from "../filesystem"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "../tool-registry"

export const name = "list"

const definition = Tool.make({
  description: "List direct children of a directory relative to the current location.",
  parameters: FileSystem.ListPageInput,
  success: FileSystem.ListPage,
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const filesystem = yield* FileSystem.Service
    const permission = yield* PermissionV2.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        execute: ({ parameters, sessionID }) => Effect.gen(function* () {
          const target = yield* filesystem.resolveList(parameters)
          yield* permission.assert({ sessionID, action: name, resources: [target.resource], save: ["*"] })
          return yield* filesystem.listPageResolved(target, { offset: parameters.offset, limit: parameters.limit })
        }).pipe(
          Effect.catchCause((cause) => Effect.fail(new ToolFailure({ message: `Unable to list ${parameters.path ?? "."}`, error: Cause.squash(cause) }))),
        ),
      }),
    )
  }),
)
