import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { Command } from "../command"

export const CommandRoute = new Hono().get(
  "/",
  describeRoute({
    summary: "List commands",
    description: "Get a list of all available commands in the OpenCode system.",
    operationId: "command.list",
    responses: {
      200: {
        description: "List of commands",
        content: {
          "application/json": {
            schema: resolver(Command.Info.array()),
          },
        },
      },
    },
  }),
  async (c) => {
    const commands = await Command.list()
    return c.json(commands)
  },
)
