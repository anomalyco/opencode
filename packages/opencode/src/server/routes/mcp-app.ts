import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { MCP } from "@/mcp"
import { errors } from "../error"
import { lazy } from "@/util/lazy"
import { Effect } from "effect"
import { jsonRequest } from "./instance/trace"

export const McpAppRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List MCP App tools",
        description: "List all MCP tools that declare a UI resource via _meta.ui.resourceUri.",
        operationId: "mcp.app.list",
        responses: {
          200: {
            description: "Map of tool key to app meta",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.AppMeta)),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = MCP.apps()
        return c.json(result)
      },
    )
    .get(
      "/resource",
      describeRoute({
        summary: "Get MCP App resource HTML",
        description: "Read the HTML resource for an MCP App tool.",
        operationId: "mcp.app.resource",
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
      async (c) =>
        jsonRequest("McpAppRoutes.resource", c, function* () {
          const query = c.req.valid("query")
          const mcp = yield* MCP.Service
          const resource = yield* Effect.promise(async () => {
            const readResourceFn = async (server: string, uri: string) => {
              return Effect.runPromise(mcp.readResource(server, uri))
            }
            return MCP.appResource(query.server, query.uri, readResourceFn, query.force)
          })
          if (!resource) return c.json({ error: "resource not found" }, 400)
          return c.json(resource)
        }),
    )
    .post(
      "/tool-call",
      describeRoute({
        summary: "Proxy tool call from MCP App iframe",
        description: "Forward a tools/call request from an MCP App iframe to the originating MCP server.",
        operationId: "mcp.app.tool-call",
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
      async (c) =>
        jsonRequest("McpAppRoutes.toolCall", c, function* () {
          const body = c.req.valid("json")
          const mcp = yield* MCP.Service
          const clients = yield* mcp.clients()
          const client = clients[body.server]
          if (!client) return c.json({ error: "server not found" }, 400)
          const result = yield* Effect.tryPromise(() =>
            client.callTool({ name: body.name, arguments: body.arguments ?? {} }),
          )
          return c.json(result)
        }),
    ),
)
