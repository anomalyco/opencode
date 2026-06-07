export * as GrepTool from "./grep"

import { ToolFailure, toolText } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { FileSystem } from "../filesystem"
import { LocationSearch } from "../location-search"
import { Ripgrep } from "../ripgrep"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "grep"

export const Parameters = Schema.Struct({
  pattern: LocationSearch.GrepInput.fields.pattern.annotate({
    description: "Regex pattern to search for in file contents",
  }),
  path: LocationSearch.GrepInput.fields.path.annotate({
    description: "Relative file or directory to search. Defaults to the active Location.",
  }),
  reference: LocationSearch.GrepInput.fields.reference.annotate({
    description: "Named project reference to search instead of the active Location",
  }),
  include: LocationSearch.GrepInput.fields.include.annotate({
    description: 'File glob to include in the search (for example, "*.js" or "*.{ts,tsx}")',
  }),
  limit: LocationSearch.GrepInput.fields.limit.annotate({
    description: `Maximum matches to return (default: ${LocationSearch.DEFAULT_RESULT_LIMIT})`,
  }),
})

type Success = typeof LocationSearch.GrepResult.Encoded

/** Format raw Location search matches into the familiar concise model output. */
export const toModelOutput = (output: Success) => {
  const lines = output.items.length === 0 ? ["No files found"] : [`Found ${output.items.length} matches`]
  let current = ""
  for (const match of output.items) {
    if (current !== match.resource) {
      if (current) lines.push("")
      current = match.resource
      lines.push(`${match.resource}:`)
    }
    lines.push(`  Line ${match.line}: ${match.lines}${match.linePreviewTruncated ? "..." : ""}`)
  }
  if (output.truncated) {
    lines.push(
      "",
      `(Results are truncated: showing first ${output.items.length} matches. Consider using a more specific path or pattern.)`,
    )
  }
  if (output.partial) lines.push("", "(Some paths were inaccessible and skipped)")
  return lines.join("\n")
}

/**
 * Location-scoped grep leaf. FileSystem supplies canonical permission metadata;
 * LocationSearch resolves the current root and owns containment and ripgrep execution.
 *
 * TODO: Revisit root-specific search permission resources if named-reference policy needs independent allow/deny rules.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const filesystem = yield* FileSystem.Service
    const search = yield* LocationSearch.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Search file contents by regular expression within the active Location, a named project reference, or an absolute managed tool-output file. Use a path to narrow the search, include to filter files by glob, and limit to bound the match count. Returns concise file resources, line numbers, and bounded line previews.",
          input: Parameters,
          output: LocationSearch.GrepResult,
          toModelOutput: ({ output }) => [toolText({ type: "text", text: toModelOutput(output) })],
          execute: (input, context) =>
            Effect.gen(function* () {
              const root = yield* filesystem.resolveRoot(input)
              yield* permission.assert({
                action: name,
                resources: [input.pattern],
                save: ["*"],
                metadata: {
                  root: root.resource,
                  reference: input.reference,
                  path: input.path,
                  include: input.include,
                  limit: input.limit,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              return yield* search.grep(input)
            }).pipe(
              Effect.mapError((error) => {
                const message =
                  error instanceof Ripgrep.InvalidPatternError
                    ? `Invalid grep pattern ${JSON.stringify(input.pattern)}: ${error.message}`
                    : `Unable to grep for ${input.pattern}`
                return new ToolFailure({ message })
              }),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
