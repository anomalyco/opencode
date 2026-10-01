export * as ShellPermission from "./shell-permission.js"

import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import type { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"
import { Config } from "../config.js"
import { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import { Permission } from "../permission.js"
import { ShellParse } from "../shell/parse.js"

// Shell-backed tools share the same leaf authorization, after plugins finish mutating the invocation.
export const prepare = Effect.gen(function* () {
  const environment = yield* Environment.Service
  const access = yield* FileAccess.Service
  const permission = yield* Permission.Service
  const config = yield* Config.Service

  return Effect.fn("ShellPermission.prepare")(function* (invocation: ShellCreateBefore, context: Tool.Context) {
    invocation.env.AGENT = "1"
    invocation.env.OPENCODE = "1"
    invocation.env.AI_AGENT ||= "opencode"
    invocation.env.OPENCODE_SESSION_ID = context.sessionID
    const source = {
      type: "tool" as const,
      messageID: context.messageID,
      id: context.id,
    }
    const target = yield* access.resolve({ path: invocation.cwd, kind: "directory" })
    invocation.cwd = target.absolute
    const timeout = invocation.timeout
    const portable = Config.latest(yield* config.entries(), "experimental")?.portable_shell_scanner === true
    const parsed = yield* ShellParse.scan(invocation.command, invocation.shell, target.absolute, { portable })
    const directories = yield* Effect.forEach(parsed.directories, (directory) =>
      access.resolve({
        path: FileAccess.resolvePath(target.absolute, directory),
        kind: "directory",
      }),
    )
    yield* access.authorizeExternal([target, ...directories], context)
    if (parsed.commands.length > 0)
      yield* permission.assert({
        action: "shell",
        resources: parsed.commands.map((command) => command.resource),
        save: parsed.commands.map((command) => command.save),
        sessionID: context.sessionID,
        agent: context.agent,
        source,
      })
    // Approval can outlive the directory, so validate immediately before spawning.
    const workdir = yield* Environment.typeFollowing(environment.files, target.absolute).pipe(
      Effect.catchTag("Environment.NotFound", () =>
        Effect.fail(new Error(`Working directory does not exist: ${target.absolute}`)),
      ),
    )
    if (workdir !== "directory")
      return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.absolute}`))
    return timeout
  })
})
