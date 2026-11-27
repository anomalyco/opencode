import { Effect } from "effect"
import { Service } from "@opencode/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"

export default Runtime.handler(
  Commands.commands.service.commands.stop,
  Effect.fn("cli.service.stop")(function* () {
    // No explicit daemon shutdown: stopping without a handoff drops the daemon's owner, which stops it with its processes.
    yield* Service.stop({ file: yield* ServiceConfig.registrationFile() })
  }),
)
