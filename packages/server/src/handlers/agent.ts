import { Agent } from "@opencode-ai/core/agent"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import { AgentNotFoundError } from "@opencode-ai/protocol/errors"

export const AgentHandler = HttpApiBuilder.group(Api, "server.agent", (handlers) =>
  handlers
    .handle("agent.list", () =>
      Effect.gen(function* () {
        return yield* response(Agent.Service.use((agent) => agent.list()))
      }),
    )
    .handle(
      "agent.get",
      Effect.fn(function* (ctx) {
        const agent = yield* Agent.Service.use((service) => service.get(ctx.params.agentID))
        if (!agent)
          return yield* new AgentNotFoundError({
            agentID: ctx.params.agentID,
            message: `Agent not found: ${ctx.params.agentID}`,
          })
        return yield* response(Effect.succeed(agent))
      }),
    ),
)
