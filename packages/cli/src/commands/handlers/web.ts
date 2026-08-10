import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerProcess } from "../../server-process"

export default Runtime.handler(
  Commands.commands.web,
  Effect.fnUntraced(function* (input) {
    return yield* ServerProcess.run({
      mode: "web",
      hostname: Option.getOrUndefined(input.hostname),
      port: Option.getOrUndefined(input.port),
    })
  }),
)
