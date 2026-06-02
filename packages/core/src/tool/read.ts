export * as ReadTool from "./read"

import { tool, ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer } from "effect"
import { FileSystem } from "../filesystem"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "../tool-registry"

export const name = "read"

const definition = (filesystem: FileSystem.Interface) =>
  tool({
    description: "Read a text or binary file relative to the current location.",
    parameters: FileSystem.ReadInput,
    success: FileSystem.Content,
    execute: (input) => filesystem.read(input),
  })

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const filesystem = yield* FileSystem.Service
    const permission = yield* PermissionV2.Service

    yield* registry.update((editor) =>
      editor.set(name, {
        tool: definition(filesystem),
        authorize: ({ parameters, sessionID }) => {
          const input = parameters as FileSystem.ReadInput
          return permission
            .assert({
              sessionID,
              action: name,
              resources: [input.path],
              save: ["*"],
            })
            .pipe(
              Effect.mapError(
                (error) => new ToolFailure({ message: `Permission denied: ${name} ${input.path}`, error }),
              ),
            )
        },
      }),
    )
  }),
)
