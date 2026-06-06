/**
 * Model-facing V2 file-write leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval. Named project references
 * are read-oriented and deliberately are not accepted by mutation tools.
 */
export * as WriteTool from "./write"

import { Tool, ToolFailure, toolText } from "@opencode-ai/llm"
import { Cause, Effect, Layer, Schema } from "effect"
import { FileMutation } from "../file-mutation"
import { LocationMutation } from "../location-mutation"
import { ToolRegistry } from "./registry"

export const name = "write"

// TODO: Revisit whether model-facing mutation schemas should prefer absolute `filePath` naming for trained-in compatibility after evaluating model behavior.
export const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description:
      "File path to write. Relative paths resolve within the active Location. Absolute paths inside that Location are accepted; external absolute paths require external_directory approval. Named project references are read-oriented and are not accepted.",
  }),
  content: Schema.String.annotate({ description: "Content to write to the file" }),
})

export const Success = Schema.Struct({
  operation: Schema.Literal("write"),
  target: Schema.String,
  resource: Schema.String,
  existed: Schema.Boolean,
})
export type Success = typeof Success.Type

export const toModelOutput = (output: Success) =>
  `${output.existed ? "Wrote" : "Created"} file successfully: ${output.resource}`

const definition = Tool.make({
  description:
    "Write content to one file. Relative paths resolve within the active Location. Absolute paths inside the Location are accepted. Explicit external absolute paths require external_directory approval before edit approval. Named project references are read-oriented and are not accepted.",
  parameters: Parameters,
  success: Success,
  toModelOutput: ({ output }) => [toolText({ type: "text", text: toModelOutput(output) })],
})

/** Deferred V2 write UX integrations remain visible at the model-facing seam. */
// TODO: Add formatter integration after V2 formatter runtime exists.
// TODO: Publish watcher/file-edit events after V2 watcher integration exists.
// TODO: Add snapshots / undo after design exists.
// TODO: Add LSP notification and diagnostics after V2 LSP runtime exists.

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const mutation = yield* LocationMutation.Service
    const files = yield* FileMutation.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        execute: ({ parameters, assertPermission }) =>
          Effect.gen(function* () {
            const target = yield* mutation.resolve({ path: parameters.path, kind: "file" })
            const external = target.externalDirectory
            if (external) yield* assertPermission(LocationMutation.externalDirectoryPermission(external))
            yield* assertPermission({ action: "edit", resources: [target.resource], save: ["*"] })
            return yield* files.writeTextPreservingBom({ target, content: parameters.content })
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.fail(
                new ToolFailure({ message: `Unable to write ${parameters.path}`, error: Cause.squash(cause) }),
              ),
            ),
          ),
      }),
    )
  }),
)
