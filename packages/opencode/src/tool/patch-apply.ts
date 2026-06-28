import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Git } from "@/git"
import { InstanceState } from "@/effect/instance-state"
import { SessionCwd } from "./session-cwd"

const DESCRIPTION = [
  "Apply a standard unified diff (git-style patch) to the working tree via `git apply`.",
  "Use this when you have a unified diff (--- / +++ / @@ hunks) to apply across one or more files.",
  "The patch is applied relative to the session working directory (see change_directory).",
  "Fails cleanly if the patch does not apply; nothing is committed.",
].join("\n")

export const Parameters = Schema.Struct({
  patch: Schema.String.annotate({ description: "The unified diff text to apply" }),
})

export const PatchApplyTool = Tool.define(
  "patch_apply",
  Effect.gen(function* () {
    const git = yield* Git.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!args.patch.trim()) throw new Error("patch is empty")
          const ins = yield* InstanceState.context
          const cwd = SessionCwd.get(ctx.sessionID, ins.directory)

          yield* ctx.ask({
            permission: "edit",
            patterns: ["*"],
            always: ["*"],
            metadata: { patch: args.patch.slice(0, 4000) },
          })

          const patch = args.patch.endsWith("\n") ? args.patch : args.patch + "\n"
          const result = yield* git.applyPatch(cwd, patch)
          if (result.exitCode !== 0) {
            throw new Error(`git apply failed (exit ${result.exitCode}): ${result.stderr.toString("utf8").trim()}`)
          }

          return {
            title: "patch applied",
            metadata: { exitCode: 0 },
            output: "Patch applied successfully.",
          }
        }).pipe(Effect.orDie),
    }
  }),
)
