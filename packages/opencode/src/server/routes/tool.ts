import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import z from "zod"
import { ToolRegistry } from "../../tool/registry"
import { zodToJsonSchema } from "zod-to-json-schema"
import { errors } from "./shared"

export function toolRoutes() {
  const router = new Hono()

  router
    .get(
      "/ids",
      describeRoute({
        description: "List all tool IDs for a provider/model (including built-in and dynamically registered)",
        operationId: "tool.ids",
        responses: {
          200: {
            description: "Tool IDs",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string()).meta({ ref: "ToolIDs" })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          provider: z.string(),
          model: z.string(),
        }),
      ),
      async (c) => {
        const { provider, model } = c.req.valid("query")
        return c.json(await ToolRegistry.ids(provider, model))
      },
    )
    .get(
      "/",
      describeRoute({
        description: "List tools with JSON schema parameters for a provider/model",
        operationId: "tool.list",
        responses: {
          200: {
            description: "Tools",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .array(
                      z
                        .object({
                          id: z.string(),
                          description: z.string(),
                          parameters: z.any(),
                        })
                        .meta({ ref: "ToolListItem" }),
                    )
                    .meta({ ref: "ToolList" }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          provider: z.string(),
          model: z.string(),
        }),
      ),
      async (c) => {
        const { provider, model } = c.req.valid("query")
        const tools = await ToolRegistry.tools(provider, model)
        return c.json(
          tools.map((t) => ({
            id: t.id,
            description: t.description,
            parameters: (t.parameters as any)?._def ? zodToJsonSchema(t.parameters as any) : t.parameters,
          })),
        )
      },
    )

  return router
}
