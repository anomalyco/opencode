import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Database } from "@opencode-ai/core/database/database"
import { recordToolMetrics } from "@/metrics"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Tool } from "@/tool/tool"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"

import { Plugin } from "@/plugin"
import type { TaskPromptOps } from "@/tool/task"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import { Effect } from "effect"
import { MessageV2 } from "./message-v2"
import * as Session from "./session"
import { SessionProcessor } from "./processor"
import { PartID } from "./schema"
import * as Log from "@opencode-ai/core/util/log"
import { EffectBridge } from "@/effect/bridge"
import { ProviderV2 } from "@opencode-ai/core/provider"

const log = Log.create({ service: "session.tools" })

export const resolve = Effect.fn("SessionTools.resolve")(function* (input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
  bypassAgentCheck: boolean
  messages: SessionLegacy.WithParts[]
  promptOps: TaskPromptOps
}) {
  using _ = log.time("resolveTools")
  const database = yield* Database.Service
  const tools: Record<string, AITool> = {}
  const run = yield* EffectBridge.make()
  const plugin = yield* Plugin.Service
  const permission = yield* Permission.Service
  const registry = yield* ToolRegistry.Service
  const mcp = yield* MCP.Service
  const truncate = yield* Truncate.Service

  const context = (args: Record<string, unknown>, options: ToolExecutionOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck, promptOps: input.promptOps },
    agent: input.agent.name,
    messages: input.messages,
    metadata: (val) =>
      input.processor.updateToolCall(options.toolCallId, (match) => {
        if (!["running", "pending"].includes(match.state.status)) return match
        return {
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            status: "running",
            input: args,
            time: { start: Date.now() },
          },
        }
      }),
    ask: (req) =>
      permission
        .ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
        })
        .pipe(Effect.orDie),
  })

  const config = yield* Config.Service
  const cfg = yield* config.get()
  const searchEnabled = cfg.toolSearch?.enabled ?? false
  const strategy = cfg.toolSearch?.strategy ?? "regex"

  const isSearchTool = (name: string): boolean =>
    name === "tool_search" ||
    name === "tool_search_tool" ||
    name === "tool_search_tool_regex" ||
    name === "tool_search_tool_bm25"

  for (const item of yield* registry.tools({
    modelID: ProviderV2.ModelID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.agent,
  })) {
    const schema = ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item))
    const sdkTool = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args: any, options) {
        return run.promise(
          Effect.gen(function* () {
            const ctx = context(args, options)
            yield* plugin.trigger(
              "tool.execute.before",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
              { args },
            )
            const result = yield* item.execute(args, ctx)
            yield* recordToolMetrics({
              sessionID: ctx.sessionID,
              toolName: item.id,
              cost: 0,
              tokensInput: 0,
              tokensOutput: 0,
            }).pipe(Effect.provideService(Database.Service, database))
            const output = {
              ...result,
              attachments: result.attachments?.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
            }
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
              output,
            )
            if (options.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(options.toolCallId, output)
            }
            return output
          }),
        )
      },
    })
    if (searchEnabled && !isSearchTool(item.id)) {
      (sdkTool as any).deferLoading = true
    }
    tools[item.id] = sdkTool
  }

  if (searchEnabled) {
    const searchToolName = `tool_search_tool_${strategy}`
    tools[searchToolName] = tool({
      description: `Search for available tools using ${strategy} pattern matching.`,
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      }),
      async execute(args) {
        const query = String(args.query)
        const regex = new RegExp(query, "i")
        const matching: string[] = []

        // Registry tools
        const allRegistry = await run.promise(registry.all())
        for (const item of allRegistry) {
          if (item.id.match(regex) || item.description?.match(regex)) {
            matching.push(item.id)
          }
        }

        // MCP tools
        const mcpTools = await run.promise(mcp.tools())
        for (const [name, def] of Object.entries(mcpTools)) {
          if (name.match(regex) || def.description?.match(regex)) {
            matching.push(name)
          }
        }

        const toolReferences = matching.slice(0, 5).map((name) => ({
          type: "tool_reference" as const,
          tool_name: name,
        }))

        return {
          title: "Tool Search Results",
          metadata: {},
          output: `Found matching tools: ${matching.slice(0, 5).join(", ")}`,
          content: [
            {
              type: "tool_search_tool_search_result",
              tool_references: toolReferences,
            },
          ]
        } as any
      }
    })
  }

  for (const [key, item] of Object.entries(yield* mcp.tools())) {
    const execute = item.execute
    if (!execute) continue

    const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
    const transformed = ProviderTransform.schema(input.model, schema)
    item.inputSchema = jsonSchema(transformed)
    item.execute = (args, opts) =>
      run.promise(
        Effect.gen(function* () {
          const ctx = context(args, opts)
          yield* plugin.trigger(
            "tool.execute.before",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
            { args },
          )
          const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.gen(function* () {
            yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
            return yield* Effect.promise(() => execute(args, opts))
          }).pipe(
            Effect.withSpan("Tool.execute", {
              attributes: {
                "tool.name": key,
                "tool.call_id": opts.toolCallId,
                "session.id": ctx.sessionID,
                "message.id": input.processor.message.id,
              },
            }),
          )
          yield* recordToolMetrics({
            sessionID: ctx.sessionID,
            toolName: key,
            cost: 0,
            tokensInput: 0,
            tokensOutput: 0,
          }).pipe(Effect.provideService(Database.Service, database))
          yield* plugin.trigger(
            "tool.execute.after",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
            result,
          )

          const textParts: string[] = []
          const attachments: Omit<SessionLegacy.FilePart, "id" | "sessionID" | "messageID">[] = []
          for (const contentItem of result.content) {
            if (contentItem.type === "text") textParts.push(contentItem.text)
            else if (contentItem.type === "image") {
              attachments.push({
                type: "file",
                mime: contentItem.mimeType,
                url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
              })
            } else if (contentItem.type === "resource") {
              const { resource } = contentItem
              if (resource.text) textParts.push(resource.text)
              if (resource.blob) {
                attachments.push({
                  type: "file",
                  mime: resource.mimeType ?? "application/octet-stream",
                  url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                  filename: resource.uri,
                })
              }
            }
          }

          const truncated = yield* truncate.output(textParts.join("\n\n"), {}, input.agent)
          const metadata = {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { outputPath: truncated.outputPath }),
          }

          const output = {
            title: "",
            metadata,
            output: truncated.content,
            attachments: attachments.map((attachment) => ({
              ...attachment,
              id: PartID.ascending(),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
            content: result.content,
          }
          if (opts.abortSignal?.aborted) {
            yield* input.processor.completeToolCall(opts.toolCallId, output)
          }
          return output
        }),
      )
    tools[key] = item
  }

  return tools
})

export * as SessionTools from "./tools"
