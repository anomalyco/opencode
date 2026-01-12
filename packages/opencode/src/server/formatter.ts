import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { Format } from "../format"

export const FormatterRoute = new Hono().get(
  "/",
  describeRoute({
    summary: "Get formatter status",
    description: "Get formatter status",
    operationId: "formatter.status",
    responses: {
      200: {
        description: "Formatter status",
        content: {
          "application/json": {
            schema: resolver(Format.Status.array()),
          },
        },
      },
    },
  }),
  async (c) => {
    return c.json(await Format.status())
  },
)
