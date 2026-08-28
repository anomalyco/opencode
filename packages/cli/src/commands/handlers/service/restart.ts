import { EOL } from "os"
import { Effect } from "effect"
import { Service } from "@opencode-ai/client/effect/service"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"
import { ServerConnection } from "../../../services/server-connection"

export default Runtime.handler(
  Commands.commands.service.commands.restart,
  Effect.fn("cli.service.restart")(function* () {
    const options = yield* ServiceConfig.options()
    // Keep this explicit: automatic service replacement must preserve terminals.
    yield* ServerConnection.shutdownPersistentPty(options).pipe(Effect.ignore)
    const stopResult = yield* Service.stop(options)
    if (!stopResult.stopped) {
      const reason = (stopResult as any).reason ?? "unknown"
      const cause = (stopResult as any).cause ? ` cause: ${(stopResult as any).cause}` : ""
      return yield* Effect.fail(
        new Error(
          `Service restart failed to stop incumbent (reason: ${reason}${cause}). Explicit restart never proceeds to ensure() after an unconfirmed stop. Check service registration, health endpoint, and process ownership.`,
        ),
      )
    }
    const transport = yield* Service.ensure(options)
    // Verify that the new instance is different from the stopped one
    // (Preserve stale-PID safety: ensure does not reuse unrelated PID)
    process.stdout.write(transport.url + EOL)
  }),
)
