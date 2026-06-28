import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Git } from "@/git"
import { InstanceState } from "@/effect/instance-state"
import { SessionCwd } from "./session-cwd"

const DESCRIPTION = [
  "Stage changes and create a git commit. Scoped and safe: it only stages + commits.",
  "It never pushes, force-pushes, rebases, amends, or rewrites history — use shell for those.",
  "",
  "Pass `paths` to stage specific files, or omit it to stage all changes (git add -A).",
  "Relative paths resolve against the session working directory (see change_directory).",
].join("\n")

export const Parameters = Schema.Struct({
  message: Schema.String.annotate({ description: "The commit message" }),
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Files to stage. Omit to stage all changes (git add -A).",
  }),
})

export const GitCommitTool = Tool.define(
  "git_commit",
  Effect.gen(function* () {
    const git = yield* Git.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!args.message.trim()) throw new Error("commit message is required")
          const ins = yield* InstanceState.context
          const cwd = SessionCwd.get(ctx.sessionID, ins.directory)

          yield* ctx.ask({
            permission: "git_commit",
            patterns: ["*"],
            always: ["*"],
            metadata: { message: args.message, paths: args.paths },
          })

          const addArgs =
            args.paths && args.paths.length > 0 ? ["add", "--", ...args.paths] : ["add", "-A"]
          const add = yield* git.run(addArgs, { cwd })
          if (add.exitCode !== 0) {
            throw new Error(`git add failed (exit ${add.exitCode}): ${add.stderr.toString("utf8").trim()}`)
          }

          const commit = yield* git.run(["commit", "-m", args.message], { cwd })
          const stdout = commit.text().trim()
          const stderr = commit.stderr.toString("utf8").trim()
          const output = stdout || stderr || "(no output)"

          return {
            title: commit.exitCode === 0 ? "git commit" : "git commit (nothing to commit?)",
            metadata: { exitCode: commit.exitCode },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
