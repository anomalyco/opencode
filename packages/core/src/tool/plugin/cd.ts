export * as CdTool from "./cd.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Schema } from "effect"
import { Environment } from "../../environment/index.js"
import { FileAccess } from "../../file-access.js"
import { Flag } from "../../flag.js"
import { Session } from "../../session.js"
import { SessionCwd } from "../../session/cwd.js"

export const Input = Schema.Struct({
  path: Schema.NullOr(Schema.String).annotate({
    description:
      "Target directory: a path in the current working directory's environment (absolute, relative, or ~/…), an explicit computer path (`local:/path`, `gpu:/work/app`, `gpu:~/project`, or `wrk_…:/workspace`), or `null` to reset to the session's default directory.",
  }),
})

const Output = Schema.Struct({
  cwd: Schema.NullOr(Schema.String),
  environment: Schema.NullOr(Environment.ID),
})

export const Plugin = {
  id: "opencode.tool.cd",
  effect: Effect.fn("CdTool.Plugin")(function* (ctx: Context) {
    if (!(yield* Flag.enabled("machines"))) return
    const access = yield* FileAccess.Service
    const environment = yield* Environment.Service
    const sessions = yield* Session.Service

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "cd",
          description: [
            "Change this session's working directory. Plain paths resolve in the current working directory's environment; use `local:/path` (or `null` to reset to the session default) to return to the server host, `gpu:/work/app` for a paired computer, or `wrk_…:/workspace` for a sandbox.",
            "Takes effect from the next step (other tool calls in the same step keep the current working directory). Loads the new directory's AGENTS.md automatically; project .opencode/ plugins stay with the session's Location.",
          ].join(" "),
          input: Input,
          output: Output,
          options: { codemode: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              if (input.path === null) {
                yield* sessions.setCwd({ sessionID: context.sessionID, cwd: undefined })
                return {
                  output: { cwd: null, environment: null },
                  content: "Reset working directory to the session default from the next step.",
                }
              }

              const trimmed = input.path.trim()
              if (trimmed === "")
                return yield* new ToolFailure({ message: "Working directory path must not be empty." })

              const target = yield* access.resolve({ path: trimmed, kind: "directory" })
              // Authorize leaving the current boundary before probing the target filesystem so denied calls
              // cannot probe external paths or cold-wake a lazy sandbox. Only host-local project worktrees are exempt.
              if (target.externalDirectory) {
                const worktrees = target.environment.hostsServer
                  ? yield* ctx.worktree.list({ projectID: ctx.location.project.id })
                  : []
                if (!worktrees.some((worktree) => FSUtil.contains(worktree.directory, target.absolute)))
                  yield* access.authorizeExternal([target], context, { cd: true })
              }

              const type = yield* Environment.typeFollowing(target.environment.files, target.absolute).pipe(
                Effect.catchTag("Environment.NotFound", () =>
                  Effect.fail(new ToolFailure({ message: `Working directory does not exist: ${trimmed}` })),
                ),
              )
              if (type !== "directory")
                return yield* new ToolFailure({ message: `Working directory is not a directory: ${trimmed}` })

              yield* sessions.setCwd({
                sessionID: context.sessionID,
                cwd: { absolute: target.absolute, environment: { id: target.environment.id } },
              })

              const formatted = SessionCwd.describe(
                { absolute: target.absolute, environment: target.environment },
                environment.id,
              ).path
              return {
                output: { cwd: formatted, environment: target.environment.id },
                content: `Working directory set to ${formatted} from the next step. Other tool calls in this step still use the previous working directory.`,
              }
            }).pipe(
              Effect.mapError((error) => {
                if (error instanceof ToolFailure) return error
                return new ToolFailure({
                  message: `Unable to change working directory to ${input.path ?? "default"}`,
                  error,
                })
              }),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}
