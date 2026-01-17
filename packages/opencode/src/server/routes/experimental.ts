import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { ToolRegistry } from "../../tool/registry"
import { Session } from "../../session"
import { Agent } from "../../agent/agent"
import { Storage } from "../../storage/storage"
import { Tool } from "../../tool/tool"
import { PermissionNext } from "@/permission/next"
import { Worktree } from "../../worktree"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { MCP } from "../../mcp"
import { zodToJsonSchema } from "zod-to-json-schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const ExperimentalRoutes = lazy(() =>
  new Hono()
    .get(
      "/tool/ids",
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
      "/tool",
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
        const { provider, model } = c.req.valid("query")
        const tools = await ToolRegistry.tools({ providerID: provider, modelID: model })
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
    .post(
      "/tool/execute",
      describeRoute({
        summary: "Execute tool",
        description: "Execute a specific tool with the provided arguments. Returns the tool output.",
        operationId: "tool.execute",
        responses: {
          200: {
            description: "Tool execution result",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      title: z.string(),
                      output: z.string(),
                      metadata: z.record(z.string(), z.any()).optional(),
                    })
                    .meta({ ref: "ToolExecuteResult" }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          sessionID: z.string().meta({ description: "Session ID for context" }),
          messageID: z.string().meta({ description: "Message ID for context" }),
          providerID: z.string().meta({ description: "Provider ID for tool filtering" }),
          modelID: z.string().meta({ description: "Model ID for tool filtering" }),
          toolID: z.string().meta({ description: "Tool ID to execute" }),
          args: z.record(z.string(), z.any()).meta({ description: "Tool arguments" }),
          agent: z.string().optional().meta({ description: "Agent name (optional)" }),
          callID: z.string().optional().meta({ description: "Tool call ID (optional)" }),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const session = await Session.get(body.sessionID)
        const agentName = body.agent ?? (await Agent.defaultAgent())
        const agent = await Agent.get(agentName)
        if (!agent) {
          throw new Storage.NotFoundError({ message: `Agent not found: ${agentName}` })
        }

        const tools = await ToolRegistry.tools({ providerID: body.providerID, modelID: body.modelID }, agent)
        const tool = tools.find((t) => t.id === body.toolID)
        if (!tool) {
          throw new Storage.NotFoundError({ message: `Tool not found: ${body.toolID}` })
        }

        const abortController = new AbortController()
        let currentMetadata: { title?: string; metadata?: Record<string, any> } = {}

        const ctx: Tool.Context = {
          sessionID: body.sessionID,
          messageID: body.messageID,
          agent: agentName,
          abort: abortController.signal,
          callID: body.callID,
          metadata: (input) => {
            currentMetadata = input
          },
          ask: async (req) => {
            await PermissionNext.ask({
              ...req,
              sessionID: session.id,
              tool: body.callID ? { messageID: body.messageID, callID: body.callID } : undefined,
              ruleset: PermissionNext.merge(agent.permission, session.permission ?? []),
            })
          },
        }

        const result = await tool.execute(body.args, ctx)
        return c.json({
          title: result.title || currentMetadata.title || "",
          output: result.output,
          metadata: result.metadata,
        })
      },
    )
    .post(
      "/worktree",
      describeRoute({
        summary: "Create worktree",
        description: "Create a new git worktree for the current project.",
        operationId: "worktree.create",
        responses: {
          200: {
            description: "Worktree created",
            content: {
              "application/json": {
                schema: resolver(Worktree.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.create.schema),
      async (c) => {
        const body = c.req.valid("json")
        const worktree = await Worktree.create(body)
        return c.json(worktree)
      },
    )
    .get(
      "/worktree",
      describeRoute({
        summary: "List worktrees",
        description: "List all sandbox worktrees for the current project.",
        operationId: "worktree.list",
        responses: {
          200: {
            description: "List of worktree directories",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
        },
      }),
      async (c) => {
        const sandboxes = await Project.sandboxes(Instance.project.id)
        return c.json(sandboxes)
      },
    )
    .delete(
      "/worktree",
      describeRoute({
        summary: "Remove worktree",
        description: "Remove a git worktree and delete its branch.",
        operationId: "worktree.remove",
        responses: {
          200: {
            description: "Worktree removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.remove.schema),
      async (c) => {
        const body = c.req.valid("json")
        await Worktree.remove(body)
        await Project.removeSandbox(Instance.project.id, body.directory)
        return c.json(true)
      },
    )
    .post(
      "/worktree/reset",
      describeRoute({
        summary: "Reset worktree",
        description: "Reset a worktree branch to the primary default branch.",
        operationId: "worktree.reset",
        responses: {
          200: {
            description: "Worktree reset",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.reset.schema),
      async (c) => {
        const body = c.req.valid("json")
        await Worktree.reset(body)
        return c.json(true)
      },
    )
    .get(
      "/resource",
      describeRoute({
        summary: "Get MCP resources",
        description: "Get all available MCP resources from connected servers. Optionally filter by name.",
        operationId: "experimental.resource.list",
        responses: {
          200: {
            description: "MCP resources",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Resource)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await MCP.resources())
      },
    ),
)
