export * as GlobTool from "./glob"

import { ToolFailure } from "@opencode-ai/ai"
import type { Context as PluginContext } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect, Schema } from "effect"
import path from "path"
import { FileSystem } from "../filesystem"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { Ripgrep } from "../ripgrep"
import { RelativePath } from "../schema"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"

export const name = "glob"

export const Input = Schema.Struct({
  pattern: FileSystem.GlobInput.fields.pattern.annotate({ description: "Glob pattern to match files against" }),
  path: RelativePath.pipe(Schema.optional).annotate({
    description: "Relative directory to search. Defaults to the active Location.",
  }),
  limit: FileSystem.GlobInput.fields.limit.annotate({
    description: `Maximum results to return (default: ${FileSystem.DEFAULT_SEARCH_LIMIT})`,
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
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const mutation = yield* LocationMutation.Service
    const permission = yield* PermissionV2.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add(
          name,
          Tool.make({
            description:
              "Find files by glob pattern within the active Location. Returns concise relative file resources. Use a relative path to narrow the search and limit to bound the result count.",
            input: Input,
            output: Output,
            execute: (input, context) =>
              Effect.gen(function* () {
                const source = { type: "tool" as const, messageID: context.messageID, callID: context.callID }
                const target = yield* mutation.resolve({ path: input.path ?? ".", kind: "directory" })
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
                    root: input.path ?? ".",
                    path: input.path,
                    limit: input.limit,
                  },
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
                yield* fs
                  .stat(target.canonical)
                  .pipe(
                    Effect.catchReason("PlatformError", "NotFound", () =>
                      Effect.fail(new ToolFailure({ message: `Search path does not exist: ${input.path ?? "."}` })),
                    ),
                  )
                const root = path.resolve(location.directory, input.path ?? ".")
                const limit = input.limit ?? FileSystem.DEFAULT_SEARCH_LIMIT
                const entries = yield* ripgrep
                  .glob({
                    cwd: target.canonical,
                    pattern: input.pattern,
                    limit: limit + 1,
                  })
                  .pipe(
                    Effect.map((result) =>
                      result.map((entry) =>
                        FileSystem.Entry.make({
                          ...entry,
                          path: RelativePath.make(path.relative(location.directory, path.resolve(root, entry.path))),
                        }),
                      ),
                    ),
                  )
                return { entries: entries.slice(0, limit), truncated: entries.length > limit }
              }).pipe(
                Effect.map((result) => ({
                  output: result.entries,
                  content: toModelContent(
                    result.entries.map((entry) => ({ ...entry, path: path.resolve(location.directory, entry.path) })),
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
          { codemode: false },
        ),
      )
      .pipe(Effect.orDie)
  }),
}
