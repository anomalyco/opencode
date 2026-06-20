/**
 * Model-facing V2 file-write leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval.
 */
export * as WriteTool from "./write"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { FileMutation } from "../file-mutation"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "write"

// TODO: Revisit whether model-facing mutation schemas should prefer absolute `filePath` naming for trained-in compatibility after evaluating model behavior.
export const Input = Schema.Struct({
  path: Schema.String.annotate({
    description:
      "File path to write. Relative paths resolve within the active Location. Absolute paths inside that Location are accepted; external absolute paths require external_directory approval.",
  }),
  content: Schema.String.annotate({ description: "Content to write to the file" }),
})

export const Output = Schema.Struct({
  operation: Schema.Literal("write"),
  target: Schema.String,
  resource: Schema.String,
  existed: Schema.Boolean,
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) =>
  `${output.existed ? "Wrote" : "Created"} file successfully: ${output.resource}`

/** Deferred V2 write UX integrations remain visible at the model-facing seam. */
// TODO: Add formatter integration after V2 formatter runtime exists.
// TODO: Publish watcher/file-edit events after V2 watcher integration exists.
// TODO: Add snapshots / undo after design exists.
// TODO: Add LSP notification and diagnostics after V2 LSP runtime exists.

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service
    const fs = yield* FSUtil.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.withPermission(
          Tool.make({
            description:
              "Write content to one file. Relative paths resolve within the active Location. Absolute paths inside the Location are accepted. Explicit external absolute paths require external_directory approval before edit approval.",
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
            execute: (input, context) => {
              const unableToWrite = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
                effect.pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to write ${input.path}` })))

              return Effect.gen(function* () {
                const source = {
                  type: "tool" as const,
                  messageID: context.assistantMessageID,
                  callID: context.toolCallID,
                }
                const target = yield* unableToWrite(mutation.resolve({ path: input.path, kind: "file" }))
                const external = target.externalDirectory
                if (external)
                  yield* unableToWrite(
                    permission.assert({
                      ...LocationMutation.externalDirectoryPermission(external),
                      sessionID: context.sessionID,
                      agent: context.agent,
                      source,
                    }),
                  )
                yield* unableToWrite(
                  permission.assert({
                    action: "edit",
                    resources: [target.resource],
                    save: ["*"],
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source,
                  }),
                )

                // Guard against silently wiping an existing file: empty or whitespace-only
                // content is only allowed when the target does not yet exist or is already
                // effectively empty. Creating a new empty file (e.g. __init__.py, .gitkeep)
                // stays supported.
                if (input.content.trim() === "") {
                  const current = yield* unableToWrite(
                    fs
                      .readFile(target.canonical)
                      .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined))),
                  )
                  if (current !== undefined && new TextDecoder().decode(current).trim() !== "") {
                    return yield* new ToolFailure({
                      message: `Refusing to overwrite ${input.path} with empty content: the file already has content. Provide the file's full intended contents, or remove the file explicitly if you mean to delete it.`,
                    })
                  }
                }

                return yield* unableToWrite(files.writeTextPreservingBom({ target, content: input.content }))
              })
            },
          }),
          "edit",
        ),
      })
      .pipe(Effect.orDie)
  }),
)
