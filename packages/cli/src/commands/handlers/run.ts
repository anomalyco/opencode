import { Effect, Option, Redacted } from "effect"
import { Commands } from "../commands"
import { Env } from "../../env"
import { Runtime } from "../../framework/runtime"

export default Runtime.handler(Commands.commands.run, (input) =>
  Effect.gen(function* () {
    const { runNonInteractive } = yield* Effect.promise(() => import("../../mini"))
    const password = yield* Env.password
    const separator = process.argv.indexOf("--", 2)
    yield* Effect.promise(() =>
      runNonInteractive({
        message: [...input.message, ...(separator === -1 ? [] : process.argv.slice(separator + 1))],
        continue: input.continue,
        session: Option.getOrUndefined(input.session),
        fork: input.fork,
        model: Option.getOrUndefined(input.model),
        agent: Option.getOrUndefined(input.agent),
        format: input.format,
        file: [...input.file],
        title: Option.getOrUndefined(input.title),
        server: Option.getOrUndefined(input.server),
        password: password ? Redacted.value(password) : undefined,
        directory: Option.getOrUndefined(input.dir),
        variant: Option.getOrUndefined(input.variant),
        thinking: input.thinking,
        dangerouslySkipPermissions: input.auto || input.yolo || input.dangerouslySkipPermissions,
      }),
    )
  }),
)
