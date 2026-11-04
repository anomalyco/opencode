import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerProcess } from "../../server-process"

export default Runtime.handler(
  Commands.commands.serve,
  Effect.fnUntraced(function* (input) {
    if (input.service && input.stdio) return yield* Effect.fail(new Error("--service and --stdio cannot be combined"))
    // The managed service registers its root address for local clients, which reach it directly; under a base path the
    // server would answer them with 404.
    if (input.service && Option.isSome(input.basePath))
      return yield* Effect.fail(new Error("--base-path cannot be combined with --service"))
    return yield* ServerProcess.run({
      mode: input.service ? "service" : input.stdio ? "stdio" : "default",
      hostname: Option.getOrUndefined(input.hostname),
      port: Option.getOrUndefined(input.port),
      basePath: Option.getOrUndefined(input.basePath),
      cors: input.cors.length > 0 ? input.cors : undefined,
    })
  }),
)
