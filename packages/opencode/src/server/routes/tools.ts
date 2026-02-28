import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"
import { ToolRegistry, ToolInfo } from "../../tool/registry"
import { MCP } from "../../mcp"
import { Config } from "../../config/config"
import { PermissionNext } from "../../permission/next"

export const ToolsRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List all tools",
        description: "List all available tools",
        operationId: "tools.list",
        responses: {
          200: {
            description: "Tool list",
            content: {
              "application/json": {
                schema: resolver(z.array(ToolInfo)),
              },
            },
          },
        },
      }),
      async (c) => {
        const [cfg, disabled] = await Promise.all([Config.get(), ToolRegistry.disabled()])
        const ruleset = PermissionNext.fromConfig(cfg.permission ?? {})

        const builtinIds = (await ToolRegistry.ids()).filter((id) => id !== "invalid")

        const allClients = await MCP.clients()
        const allStatus = await MCP.status()
        const mcpCandidates: { key: string; serverName: string }[] = []
        for (const [serverName, client] of Object.entries(allClients)) {
          if (allStatus[serverName]?.status !== "connected") continue
          const result = await client.listTools().catch(() => undefined)
          if (!result) continue
          for (const tool of result.tools) {
            const sanitizedServer = serverName.replace(/[^a-zA-Z0-9_-]/g, "_")
            const sanitizedTool = tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
            mcpCandidates.push({ key: `${sanitizedServer}_${sanitizedTool}`, serverName })
          }
        }

        const allNames = [...builtinIds, ...mcpCandidates.map((t) => t.key)]
        const deniedByPermission = PermissionNext.disabled(allNames, ruleset)

        const builtins = builtinIds
          .filter((id) => !deniedByPermission.has(id))
          .map((id) => ({ name: id, category: "builtin", disabled: disabled.has(id) }))

        const mcpTools = mcpCandidates
          .filter((t) => !deniedByPermission.has(t.key))
          .map((t) => ({ name: t.key, category: t.serverName, disabled: disabled.has(t.key) }))

        return c.json([...builtins, ...mcpTools])
      },
    )
    .post(
      "/:name/toggle",
      describeRoute({
        summary: "Toggle a tool",
        description: "Enable or disable a tool",
        operationId: "tools.toggle",
        responses: {
          200: {
            description: "Updated disabled status",
            content: {
              "application/json": {
                schema: resolver(z.object({ disabled: z.boolean() })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const { name } = c.req.valid("param")
        const disabled = await ToolRegistry.disabled()
        if (disabled.has(name)) {
          await ToolRegistry.enable(name)
          return c.json({ disabled: false })
        } else {
          await ToolRegistry.disable(name)
          return c.json({ disabled: true })
        }
      },
    ),
)
