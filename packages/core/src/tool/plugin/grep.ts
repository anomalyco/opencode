export * as GrepTool from "./grep"

import type { Context as PluginContext } from "@opencode-ai/plugin/effect/plugin"
import { ToolFailure } from "@opencode-ai/ai"
import { Effect, Schema } from "effect"
import path from "path"
import { FileSystem } from "../../filesystem"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "../../location"
import { LocationMutation } from "../../location-mutation"
import { Permission } from "../../permission"
import { Ripgrep } from "../../ripgrep"
import { RelativePath } from "../../schema"

export const name = "grep"

export const Input = Schema.Struct({
  pattern: FileSystem.GrepInput.fields.pattern.check(
    Schema.isMinLength(1, { message: "Pattern must not be empty" }),
  ).annotate({
    description: "Regular expression to search for in file contents (ripgrep syntax)",
  }),
  path: Schema.optionalKey(RelativePath).annotate({
    description: "File or directory to search. Defaults to the current working directory.",
  }),
  include: FileSystem.GrepInput.fields.include.annotate({
    description: 'Glob pattern to filter files (for example, "*.js" or "*.{ts,tsx}")',
  }),
  limit: FileSystem.GrepInput.fields.limit.annotate({
    description: `Maximum number of matching lines to return (default: ${FileSystem.DEFAULT_SEARCH_LIMIT})`,
  }),
})

export const Output = Schema.Array(FileSystem.Match)
type EncodedOutput = typeof Output.Encoded

/** Format raw search matches into concise model content. */
export const toModelContent = (matches: EncodedOutput, truncated = false) => {
  const lines = matches.length === 0 ? ["No matches found"] : [`Found ${matches.length} matches`]
  let current = ""
  for (const match of matches) {
    if (current !== match.entry.path) {
      if (current) lines.push("")
      current = match.entry.path
      lines.push(`${match.entry.path}:`)
    }
    lines.push(`  Line ${match.line}: ${match.text}`)
  }
  if (truncated)
    lines.push(
      "",
      `(Results are truncated: showing first ${matches.length} results. Consider using a more specific path or pattern.)`,
    )
  return lines.join("\n")
}

/** Grep leaf that defaults its filesystem root to the active Location. */
export const Plugin = {
  id: "opencode.tool.grep",
  effect: Effect.fn("GrepTool.Plugin")(function* (ctx: PluginContext) {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const mutation = yield* LocationMutation.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add(
          ({
            name,
            options: { codemode: false },
            description:
              "Search file contents using regular expressions. Use it to locate specific code, symbols, or text patterns, and narrow searches with `path` or `include`. Returns matching file paths, line numbers, and line previews.",
            input: Input,
            output: Output,
            execute: (input, context) =>
              Effect.gen(function* () {
                const source = { type: "tool" as const, messageID: context.messageID, callID: context.callID }
                const target = yield* mutation.resolve({ path: input.path ?? "." })
                if (target.externalDirectory)
                  yield* permission.assert({
                    ...LocationMutation.externalDirectoryPermission(target.externalDirectory),
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source,
                  })
                yield* permission.assert({
                  action: name,
                  resources: [input.pattern],
                  save: ["*"],
                  metadata: {
                    root: ".",
                    path: input.path,
                    include: input.include,
                    limit: input.limit,
                  },
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
                const root = path.resolve(location.directory, input.path ?? ".")
                const info = yield* fs
                  .stat(root)
                  .pipe(
                    Effect.catchReason("PlatformError", "NotFound", () =>
                      Effect.fail(new ToolFailure({ message: `Search path does not exist: ${input.path ?? "."}` })),
                    ),
                  )
                const cwd = info?.type === "Directory" ? root : path.dirname(root)
                const limit = input.limit ?? FileSystem.DEFAULT_SEARCH_LIMIT
                const matches = yield* ripgrep
                  .grep({
                    cwd,
                    pattern: input.pattern,
                    file: info?.type === "File" ? path.basename(root) : undefined,
                    include: input.include,
                    limit: limit + 1,
                  })
                  .pipe(
                    Effect.map((result) =>
                      result.map((match) =>
                        FileSystem.Match.make({
                          ...match,
                          entry: FileSystem.Entry.make({
                            ...match.entry,
                            path: RelativePath.make(
                              path.relative(location.directory, path.resolve(cwd, match.entry.path)),
                            ),
                          }),
                        }),
                      ),
                    ),
                  )
                return { matches: matches.slice(0, limit), truncated: matches.length > limit }
              }).pipe(
                Effect.map((result) => ({
                  output: result.matches,
                  content: toModelContent(
                    result.matches.map((match) => ({
                      ...match,
                      entry: { ...match.entry, path: path.resolve(location.directory, match.entry.path) },
                    })),
                    result.truncated,
                  ),
                  metadata: { matches: result.matches.length, truncated: result.truncated },
                })),
                Effect.mapError((error) =>
                  error instanceof ToolFailure
                    ? error
                    : error instanceof Ripgrep.InvalidPatternError
                      ? new ToolFailure({ message: `Invalid regex pattern: ${error.message}` })
                    : new ToolFailure({ message: `Unable to grep for ${input.pattern}`, error }),
                ),
              ),
          }),
        ),
      )
      .pipe(Effect.orDie)
  }),
}
