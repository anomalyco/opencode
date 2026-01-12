import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { Agent } from "../agent/agent"

export const AgentRoute = new Hono().get(
  "/",
  describeRoute({
    summary: "List agents",
    description: "Get a list of all available AI agents in the OpenCode system.",
    operationId: "app.agents",
    responses: {
      200: {
        description: "List of agents",
        content: {
          "application/json": {
            schema: resolver(Agent.Info.array()),
          },
        },
      },
    },
  }),
  async (c) => {
    const modes = await Agent.list()
    return c.json(modes)
  },
)
