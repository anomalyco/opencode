import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerProcess } from "../../server-process"

export default Runtime.handler(
  Commands.commands.web,
  Effect.fnUntraced(function* (input) {
    if (input.service && input.stdio) return yield* Effect.fail(new Error("--service and --stdio cannot be combined"))
    return yield* ServerProcess.run({
      mode: input.service ? "service" : input.stdio ? "stdio" : "default",
      open: true,
      hostname: Option.getOrUndefined(input.hostname),
      port: Option.getOrUndefined(input.port),
    })
  }),
)
