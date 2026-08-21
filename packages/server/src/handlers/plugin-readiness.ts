import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"

export function pluginReadiness(error: () => ServiceUnavailableError) {
  return PluginSupervisor.Service.pipe(
    Effect.flatMap((plugins) => plugins.flush),
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.fail(error()),
    }),
  )
}
