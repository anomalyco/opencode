import { AgentV2 } from "@cedric/core/agent"
import { PluginBoot } from "@cedric/core/plugin/boot"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { V2Api } from "../../api"
import { response } from "../../groups/v2/location"

export const agentHandlers = HttpApiBuilder.group(V2Api, "v2.agent", (handlers) =>
  handlers.handle("agents", () =>
    Effect.gen(function* () {
      yield* PluginBoot.Service.use((plugin) => plugin.wait())
      return yield* response(AgentV2.Service.use((agent) => agent.all()))
    }),
  ),
)
