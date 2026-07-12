export * as GlobTool from "./glob"

import { ToolFailure } from "@opencode-ai/llm"
import type { Context as PluginContext } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect, Schema } from "effect"
import path from "path"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
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
    description: "Maximum results to return",
  }),
})

export const Output = Schema.Array(FileSystem.Entry)
type ModelOutput = typeof Output.Encoded

/** Format raw search results into the concise line-oriented output models expect. */
export const toModelOutput = (output: ModelOutput) => {
  const lines = output.length === 0 ? ["No files found"] : output.map((item) => item.path)
  return lines.join("\n")
}

/** Glob leaf that defaults its filesystem root to the active Location. */
export const Plugin = {
  id: "opencode.tool.glob",
  effect: Effect.fn("GlobTool.Plugin")(function* (ctx: PluginContext) {
    const fs = yield* FSUtil.Service
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
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
            toModelOutput: ({ output }) => [
              {
                type: "text",
                text: toModelOutput(
                  output.map((entry) => ({ ...entry, path: path.resolve(location.directory, entry.path) })),
                ),
              },
            ],
            execute: (input, context) =>
              Effect.gen(function* () {
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
                  source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                })
                const cwd = path.resolve(location.directory, input.path ?? ".")
                yield* fs
                  .stat(cwd)
                  .pipe(
                    Effect.catchReason("PlatformError", "NotFound", () =>
                      Effect.fail(new ToolFailure({ message: `Search path does not exist: ${input.path ?? "."}` })),
                    ),
                  )
                return yield* ripgrep
                  .glob({
                    cwd,
                    pattern: input.pattern,
                    limit: input.limit ?? Number.MAX_SAFE_INTEGER,
                  })
                  .pipe(
                    Effect.map((result) =>
                      result.map((entry) =>
                        FileSystem.Entry.make({
                          ...entry,
                          path: RelativePath.make(path.relative(location.directory, path.resolve(cwd, entry.path))),
                        }),
                      ),
                    ),
                  )
              }).pipe(
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
