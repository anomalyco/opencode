import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { LSP } from "../lsp"

export const LspRoute = new Hono().get(
  "/",
  describeRoute({
    summary: "Get LSP status",
    description: "Get LSP server status",
    operationId: "lsp.status",
    responses: {
      200: {
        description: "LSP server status",
        content: {
          "application/json": {
            schema: resolver(LSP.Status.array()),
          },
        },
      },
    },
  }),
  async (c) => {
    return c.json(await LSP.status())
  },
)
