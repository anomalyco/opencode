import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { MCP } from "../../mcp"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const McpAppRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List MCP App tools",
        description: "List all MCP tools that declare a UI resource via _meta.ui.resourceUri.",
        operationId: "mcp-app.list",
        responses: {
          200: {
            description: "MCP App tools",
            content: {
              "application/json": {
                schema: resolver(
                  z.record(z.string(), MCP.AppMeta.extend({ server: z.string() }).meta({ ref: "McpAppToolEntry" })),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await MCP.apps())
      },
    )
    .get(
      "/resource",
      describeRoute({
        summary: "Get MCP App HTML resource",
        description: "Fetch and cache the HTML bundle for a ui:// resource URI.",
        operationId: "mcp-app.resource",
        responses: {
          200: {
            description: "HTML bundle",
            content: {
              "application/json": {
                schema: resolver(MCP.AppResource),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          uri: z.string(),
          server: z.string(),
          force: z.coerce.boolean().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const resource = await MCP.appResource(query.server, query.uri, query.force)
        if (!resource) return c.json({ error: "resource not found" }, 400)
        return c.json(resource)
      },
    )
    .post(
      "/tool-call",
      describeRoute({
        summary: "Proxy tool call from MCP App iframe",
        description: "Forward a tools/call request from an MCP App iframe to the originating MCP server.",
        operationId: "mcp-app.tool-call",
        responses: {
          200: {
            description: "Tool call result",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.any())),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          server: z.string(),
          name: z.string(),
          arguments: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const snap = await MCP.clients()
        const client = snap[body.server]
        if (!client) return c.json({ error: "server not found" }, 400)
        const result = await client
          .callTool({ name: body.name, arguments: body.arguments ?? {} })
          .catch((e: Error) => ({ error: e.message }))
        return c.json(result)
      },
    ),
)
