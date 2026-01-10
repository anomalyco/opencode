import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { resolver } from "hono-openapi"
import { SystemPrompt } from "../session/system"
import z from "zod"

export const InstructionsRoute = new Hono().get(
  "/",
  describeRoute({
    summary: "List instructions",
    description: "Get a list of all instruction files loaded for the current session.",
    operationId: "instructions.list",
    responses: {
      200: {
        description: "List of instruction sources",
        content: {
          "application/json": {
            schema: resolver(
              z
                .object({
                  files: z.array(z.string()),
                  urls: z.array(z.string()),
                })
                .meta({ ref: "Instructions" }),
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    const result = await SystemPrompt.paths()
    return c.json(result)
  },
)
