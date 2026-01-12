import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { errors } from "./error"
import z from "zod"
import { Session } from "../session"
import { Agent } from "../agent/agent"
import { Storage } from "../storage/storage"
import { ToolRegistry } from "../tool/registry"
import { Tool } from "../tool/tool"
import { PermissionNext } from "@/permission/next"

export const ExperimentalRoute = new Hono().post(
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

    const tools = await ToolRegistry.tools(body.providerID, agent)
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
