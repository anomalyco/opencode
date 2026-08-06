export * as GlobTool from "./glob"

import { ToolFailure } from "@opencode-ai/ai"
import type { Context as PluginContext } from "@opencode-ai/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import path from "path"
import { FileSystem } from "../../filesystem"
import { Location } from "../../location"
import { LocationMutation } from "../../location-mutation"
import { RelativePath } from "../../schema"
import { Permission } from "../../permission"

export const name = "glob"

export const Input = Schema.Struct({
  pattern: FileSystem.GlobInput.fields.pattern.annotate({ description: "Glob pattern to match files against" }),
  path: Schema.optionalKey(RelativePath).annotate({
    description: "Directory to search. Defaults to the current working directory.",
  }),
  limit: FileSystem.GlobInput.fields.limit.annotate({
    description: `Maximum number of matching files to return (default: ${FileSystem.DEFAULT_SEARCH_LIMIT})`,
  }),
})

export const Output = Schema.Array(FileSystem.Entry)
type EncodedOutput = typeof Output.Encoded

/** Format raw search results into the concise line-oriented output models expect. */
export const toModelContent = (entries: EncodedOutput, truncated = false) => {
  const lines = entries.length === 0 ? ["No files found"] : entries.map((item) => item.path)
  if (truncated)
    lines.push(
      "",
      `(Results are truncated: showing first ${entries.length} results. Consider using a more specific path or pattern.)`,
    )
  return lines.join("\n")
}

/** Glob leaf that defaults its filesystem root to the active Location. */
export const Plugin = {
  id: "opencode.tool.glob",
  effect: Effect.fn("GlobTool.Plugin")(function* (ctx: PluginContext) {
    const filesystem = yield* FileSystem.Service
    const location = yield* Location.Service
    const resolve = Location.paths(location).resolve
    const mutation = yield* LocationMutation.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add({
          name,
          options: { codemode: false },
          description: 'Search file paths using a glob pattern (examples: "**/*.ts", "src/**/*.tsx").',
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const searchPath = input.path === "undefined" || input.path === "null" ? undefined : input.path
              const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
              const target = yield* mutation.resolve({ path: searchPath ?? ".", kind: "directory" })
              const external = target.externalDirectory
              if (external)
                yield* permission.assert({
                  ...LocationMutation.externalDirectoryPermission(external),
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
              yield* permission.assert({
                action: name,
                resources: [input.pattern],
                save: ["*"],
                metadata: {
                  root: searchPath ?? ".",
                  path: searchPath,
                  limit: input.limit,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              const limit = input.limit ?? FileSystem.DEFAULT_SEARCH_LIMIT
              const entries = yield* filesystem
                .glob({
                  target,
                  pattern: input.pattern,
                  limit: limit + 1,
                })
                .pipe(
                  FileSystem.searchTimeout((message) => new ToolFailure({ message })),
                  Effect.catchTag("FileSystem.SearchPathError", (error) =>
                    Effect.fail(
                      new ToolFailure({
                        message:
                          error.reason === "not_found"
                            ? `Search path does not exist: ${searchPath ?? "."}`
                            : `Search path is not a directory: ${searchPath ?? "."}`,
                      }),
                    ),
                  ),
                )
              return { entries: entries.slice(0, limit), truncated: entries.length > limit }
            }).pipe(
              Effect.map((result) => ({
                output: result.entries,
                content: toModelContent(
                  result.entries.map((entry) => ({ ...entry, path: resolve(location.directory, entry.path) })),
                  result.truncated,
                ),
                metadata: { count: result.entries.length, truncated: result.truncated },
              })),
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: `Unable to find files matching ${input.pattern}`, error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
