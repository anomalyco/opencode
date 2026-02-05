import z from "zod"
import { type Tool as AITool, tool, jsonSchema, asSchema } from "ai"
import { Identifier } from "../../id/id"
import { MessageV2 } from "../message-v2"
import { Log } from "../../util/log"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import { ProviderTransform } from "../../provider/transform"
import { Plugin } from "../../plugin"
import { ToolRegistry } from "../../tool/registry"
import { MCP } from "../../mcp"
import { Session } from ".."
import { SessionProcessor } from "../processor"
import { ToolContext } from "../tool-context"
import { Truncate } from "../../tool/truncation"

const log = Log.create({ service: "session.prompt.tools" })

export async function resolveTools(input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  tools?: Record<string, boolean>
  processor: SessionProcessor.Info
  bypassAgentCheck: boolean
  messages: MessageV2.WithParts[]
}) {
  using _ = log.time("resolveTools")
  const tools: Record<string, AITool> = {}

  const context = ToolContext.forTool(input)

  for (const item of await ToolRegistry.tools(
    { modelID: input.model.api.id, providerID: input.model.providerID },
    input.agent,
  )) {
    const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      async execute(args, options) {
        const ctx = context(args, options)
        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: item.id,
            sessionID: ctx.sessionID,
            callID: ctx.callID,
          },
          {
            args,
          },
        )
        const result = await item.execute(args, ctx)
        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: item.id,
            sessionID: ctx.sessionID,
            callID: ctx.callID,
          },
          result,
        )
        return result
      },
    })
  }

  for (const [key, item] of Object.entries(await MCP.tools())) {
    const execute = item.execute
    if (!execute) continue

    const transformed = ProviderTransform.schema(input.model, asSchema(item.inputSchema).jsonSchema)
    item.inputSchema = jsonSchema(transformed)
    // Wrap execute to add plugin hooks and format output
    item.execute = async (args, opts) => {
      const ctx = context(args, opts)

      await Plugin.trigger(
        "tool.execute.before",
        {
          tool: key,
          sessionID: ctx.sessionID,
          callID: opts.toolCallId,
        },
        {
          args,
        },
      )

      await ctx.ask({
        permission: key,
        metadata: {},
        patterns: ["*"],
        always: ["*"],
      })

      const result = await execute(args, opts)

      await Plugin.trigger(
        "tool.execute.after",
        {
          tool: key,
          sessionID: ctx.sessionID,
          callID: opts.toolCallId,
        },
        result,
      )

      const textParts: string[] = []
      const attachments: MessageV2.FilePart[] = []

      for (const contentItem of result.content) {
        if (contentItem.type === "text") {
          textParts.push(contentItem.text)
        } else if (contentItem.type === "image") {
          attachments.push({
            id: Identifier.ascending("part"),
            sessionID: input.session.id,
            messageID: input.processor.message.id,
            type: "file",
            mime: contentItem.mimeType,
            url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
          })
        } else if (contentItem.type === "resource") {
          const { resource } = contentItem
          if (resource.text) {
            textParts.push(resource.text)
          }
          if (resource.blob) {
            attachments.push({
              id: Identifier.ascending("part"),
              sessionID: input.session.id,
              messageID: input.processor.message.id,
              type: "file",
              mime: resource.mimeType ?? "application/octet-stream",
              url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
              filename: resource.uri,
            })
          }
        }
      }

      const truncated = await Truncate.output(textParts.join("\n\n"), {}, input.agent)
      const metadata = {
        ...(result.metadata ?? {}),
        truncated: truncated.truncated,
        ...(truncated.truncated && { outputPath: truncated.outputPath }),
      }

      return {
        title: "",
        metadata,
        output: truncated.content,
        attachments,
        content: result.content, // directly return content to preserve ordering when outputting to model
      }
    }
    tools[key] = item
  }

  return tools
}
