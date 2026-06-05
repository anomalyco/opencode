export * as GlobTool from "./glob"

import { Tool, ToolFailure, toolText } from "@opencode-ai/llm"
import { Cause, Effect, Layer, Schema } from "effect"
import { FileSystem } from "../filesystem"
import { LocationSearch } from "../location-search"
import { ToolRegistry } from "./registry"

export const name = "glob"

export const Parameters = Schema.Struct({
  pattern: LocationSearch.FilesInput.fields.pattern.annotate({ description: "Glob pattern to match files against" }),
  path: LocationSearch.FilesInput.fields.path.annotate({
    description: "Relative directory to search. Defaults to the active Location.",
  }),
  reference: LocationSearch.FilesInput.fields.reference.annotate({
    description: "Named project reference to search instead of the active Location",
  }),
  limit: LocationSearch.FilesInput.fields.limit.annotate({
    description: `Maximum results to return (default: ${LocationSearch.DEFAULT_RESULT_LIMIT})`,
  }),
})

type ModelOutput = typeof LocationSearch.FilesResult.Encoded

/** Format raw Location search results into the concise line-oriented output models expect. */
export const toModelOutput = (output: ModelOutput) => {
  const lines = output.items.length === 0 ? ["No files found"] : output.items.map((item) => item.resource)
  if (output.truncated) {
    lines.push(
      "",
      `(Results are truncated: showing first ${output.items.length} results. Consider using a more specific path or pattern.)`,
    )
  }
  if (output.partial) lines.push("", "(Results may be incomplete because some discovered files could not be read.)")
  return lines.join("\n")
}

const definition = Tool.make({
  description:
    "Find files by glob pattern within the active Location or a named project reference. Returns concise relative file resources. Use a relative path to narrow the search and limit to bound the result count.",
  parameters: Parameters,
  success: LocationSearch.FilesResult,
  toModelOutput: ({ output }) => [toolText({ type: "text", text: toModelOutput(output) })],
})

/**
 * Location-scoped glob leaf. FileSystem selects a canonical root for
 * permission metadata; LocationSearch owns containment and traversal.
 *
 * TODO: Revisit root-specific search permission resources if named-reference policy needs independent allow/deny rules.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const filesystem = yield* FileSystem.Service
    const search = yield* LocationSearch.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        execute: ({ parameters, assertPermission }) =>
          Effect.gen(function* () {
            const root = yield* filesystem.resolveRoot({ path: parameters.path, reference: parameters.reference })
            yield* assertPermission({
              action: name,
              resources: [parameters.pattern],
              save: ["*"],
              metadata: {
                root: root.resource,
                reference: parameters.reference,
                path: parameters.path,
                limit: parameters.limit,
              },
            })
            return yield* search.files(parameters, root)
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.fail(
                new ToolFailure({
                  message: `Unable to find files matching ${parameters.pattern}`,
                  error: Cause.squash(cause),
                }),
              ),
            ),
          ),
      }),
    )
  }),
)
