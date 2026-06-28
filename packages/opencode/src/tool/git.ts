import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Git } from "@/git"
import { InstanceState } from "@/effect/instance-state"
import { SessionCwd } from "./session-cwd"

const operations = ["status", "diff", "log", "show", "blame", "branch"] as const

const DESCRIPTION = [
  "Inspect the git state of the repository with structured, read-only operations.",
  "Prefer this over running git through the shell: output is cleaner and cheaper on context.",
  "",
  "Operations:",
  "- status: working tree status (short + branch)",
  "- diff: changes vs working tree, or vs `ref` when provided; scope with `path`",
  "- log: recent commits (oneline); limit with `limit`, scope with `ref`/`path`",
  "- show: a commit/object (defaults to HEAD); scope with `path`",
  "- blame: line-by-line authorship for a file (`path` required)",
  "- branch: list local and remote branches",
  "",
  "Relative `path` resolves against the session working directory (see change_directory).",
  "This tool does not mutate the repository (no commit/push/checkout); use shell for that.",
].join("\n")

export const Parameters = Schema.Struct({
  operation: Schema.Literals(operations).annotate({ description: "The git operation to perform" }),
  ref: Schema.optional(Schema.String).annotate({
    description: "Git ref/commit/branch for diff/show/log (e.g. HEAD, main, a commit SHA)",
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "Limit the operation to a file or directory (required for blame)",
  }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Max entries for log (default 20)" }),
})

export const GitTool = Tool.define(
  "git",
  Effect.gen(function* () {
    const git = yield* Git.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const cwd = SessionCwd.get(ctx.sessionID, instance.directory)

          yield* ctx.ask({
            permission: "git",
            patterns: [args.operation],
            always: ["*"],
            metadata: { operation: args.operation, ref: args.ref, path: args.path },
          })

          const argv: string[] = (() => {
            switch (args.operation) {
              case "status":
                return ["status", "--short", "--branch"]
              case "diff":
                return [
                  "diff",
                  "--no-ext-diff",
                  ...(args.ref ? [args.ref] : []),
                  ...(args.path ? ["--", args.path] : []),
                ]
              case "log":
                return [
                  "log",
                  "--oneline",
                  "--decorate",
                  `--max-count=${args.limit ?? 20}`,
                  ...(args.ref ? [args.ref] : []),
                  ...(args.path ? ["--", args.path] : []),
                ]
              case "show":
                return ["show", "--no-ext-diff", args.ref ?? "HEAD", ...(args.path ? ["--", args.path] : [])]
              case "blame":
                if (!args.path) throw new Error("git blame requires a `path` argument")
                return ["blame", "--", args.path]
              case "branch":
                return ["branch", "--all", "--verbose"]
            }
          })()

          const result = yield* git.run(argv, { cwd })
          const text = result.text().trim()
          const err = result.stderr.toString("utf8").trim()
          const output =
            result.exitCode === 0
              ? text || "(no output)"
              : `git ${args.operation} failed (exit ${result.exitCode}):\n${err || text}`

          return {
            title: `git ${args.operation}`,
            metadata: { operation: args.operation, exitCode: result.exitCode, truncated: result.truncated },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
