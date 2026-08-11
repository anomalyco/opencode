import { AgentV2 } from "@opencode-ai/core/agent"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const AgentHandler = HttpApiBuilder.group(Api, "server.agent", (handlers) =>
  handlers.handle("agent.list", () =>
    Effect.gen(function* () {
      return yield* response(AgentV2.Service.use((agent) => agent.all()))
    }),
  ),
)
