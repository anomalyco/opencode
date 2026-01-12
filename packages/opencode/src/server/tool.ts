import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import { errors } from "./error"
import { ToolRegistry } from "../tool/registry"

export const ToolRoute = new Hono()
  .get(
    "/ids",
    describeRoute({
      summary: "List tool IDs",
      description:
        "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
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
    async (c) => {
      return c.json(await ToolRegistry.ids())
    },
  )
  .get(
    "/",
    describeRoute({
      summary: "List tools",
      description:
        "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
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
      const { provider } = c.req.valid("query")
      const tools = await ToolRegistry.tools(provider)
      return c.json(
        tools.map((t) => ({
          id: t.id,
          description: t.description,
          // Handle both Zod schemas and plain JSON schemas
          parameters: (t.parameters as any)?._def ? zodToJsonSchema(t.parameters as any) : t.parameters,
        })),
      )
    },
  )
