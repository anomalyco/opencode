import { Effect, Option } from "effect"
import { Commands, Server } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"

export default Runtime.handler(Commands.commands.run, (input) =>
  Effect.gen(function* () {
    const { reportRunError, runNonInteractiveWithOptions } = yield* Effect.promise(() => import("../../run/run"))
    const separator = process.argv.indexOf("--", 2)
    const attach = Option.getOrUndefined(input.attach)
    const variant = Option.getOrUndefined(input.variant)
    if (attach !== undefined) process.stderr.write("Warning: --attach is deprecated; use --server instead.\n")
    if (variant !== undefined)
      process.stderr.write("Warning: --variant is deprecated; use --model provider/model#variant instead.\n")
    if (attach !== undefined && Option.isSome(Option.flatten(yield* Effect.serviceOption(Server))))
      return reportRunError(input, "--attach and --server cannot be combined")
    const server = yield* ServerConnection.resolve({ server: attach }).pipe(
      Effect.tapError((error) => Effect.logError("run could not resolve its server", { cause: error })),
      Effect.catch((error) => Effect.sync(() => reportRunError(input, error.message))),
    )
    if (!server) return
    yield* Effect.promise(() =>
      runNonInteractiveWithOptions(
        {
          server,
          message: [...input.message, ...(separator === -1 ? [] : process.argv.slice(separator + 1))],
          continue: input.continue,
          session: Option.getOrUndefined(input.session),
          fork: input.fork,
          worktree: Option.getOrUndefined(input.worktree),
          model: Option.getOrUndefined(input.model),
          agent: Option.getOrUndefined(input.agent),
          format: input.format,
          file: [...input.file],
          title: Option.getOrUndefined(input.title),
          thinking: input.thinking,
          auto: input.auto || input.yolo || input.dangerouslySkipPermissions,
        },
        { variant },
      ),
    )
  }),
)
