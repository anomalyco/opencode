import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import z from "zod"
import { MCP } from "../../mcp"
import { Config } from "../../config/config"
import { errors } from "./shared"

export function mcpRoutes() {
  const router = new Hono()

  router
    .get(
      "/",
      describeRoute({
        description: "Get MCP server status",
        operationId: "mcp.status",
        responses: {
          200: {
            description: "MCP server status",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Status)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await MCP.status())
      },
    )
    .post(
      "/",
      describeRoute({
        description: "Add MCP server dynamically",
        operationId: "mcp.add",
        responses: {
          200: {
            description: "MCP server added successfully",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Status)),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
          config: Config.Mcp,
        }),
      ),
      async (c) => {
        const { name, config } = c.req.valid("json")
        const result = await MCP.add(name, config)
        return c.json(result.status)
      },
    )
    .get(
      "/discover",
      describeRoute({
        description: "Discover available MCP servers from registry",
        operationId: "mcp.discover",
        responses: {
          200: {
            description: "List of discoverable MCP servers",
            content: {
              "application/json": {
                schema: resolver(MCP.DiscoveredServer.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await MCP.discover())
      },
    )
    .get(
      "/:serverName/tools",
      describeRoute({
        description: "Get tools for a specific MCP server",
        operationId: "mcp.server.tools",
        responses: {
          200: {
            description: "MCP server tools",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.any())),
              },
            },
          },
        },
      }),
      async (c) => {
        const serverName = c.req.param("serverName")
        return c.json(await MCP.serverTools(serverName))
      },
    )
    .patch(
      "/:serverName",
      describeRoute({
        description: "Update MCP server configuration",
        operationId: "mcp.server.update",
        responses: {
          200: {
            description: "Successfully updated MCP server",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.boolean() })),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          enabled: z.boolean().optional(),
          disabledTools: z.string().array().optional(),
        }),
      ),
      async (c) => {
        const serverName = c.req.param("serverName")
        const updates = c.req.valid("json")
        const config = await Config.get()

        if (!config.mcp || !config.mcp[serverName]) {
          return c.json({ error: "MCP server not found" }, 404)
        }

        const updatedMcp = {
          ...config.mcp[serverName],
          ...updates,
        }

        await Config.update({
          ...config,
          mcp: {
            ...config.mcp,
            [serverName]: updatedMcp,
          },
        })

        return c.json({ success: true })
      },
    )

  return router
}
