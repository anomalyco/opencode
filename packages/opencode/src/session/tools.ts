import { Agent } from "@/agent/agent"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { Tool, InvalidArgumentsError } from "@/tool/tool"
import { ToolJsonSchema } from "@/tool/json-schema"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"

import { Plugin } from "@/plugin"
import type { TaskPromptOps } from "@/tool/task"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import { Cause, Effect } from "effect"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { errorMessage } from "@/util/error"
import { MessageV2 } from "./message-v2"
import { Session } from "./session"
import { SessionProcessor } from "./processor"
import { PartID } from "./schema"
import { EffectBridge } from "@/effect/bridge"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

export type ToolErrorAuthority = "tool" | "runtime" | "plugin"

export interface ToolErrorInfo {
  error: string
  retryable: boolean
  authority: ToolErrorAuthority
}

/**
 * Classify a failed tool call for the `tool.execute.error` plugin hook. Pass
 * `authority: "plugin"` when the failure originates in a plugin `before`/`after`
 * hook; otherwise the authority and retryability are derived from the raised error.
 */
export function classifyToolError(error: unknown, authority?: "plugin"): ToolErrorInfo {
  const message = errorMessage(error)
  // A plugin hook vetoed or crashed the call; the model may recover by adjusting and retrying.
  if (authority === "plugin") return { error: message, retryable: true, authority }
  // Permission/question rejections are raised by the runtime and are deterministic —
  // re-issuing the identical call will be rejected again.
  if (error instanceof PermissionV1.RejectedError || error instanceof Question.RejectedError)
    return { error: message, retryable: false, authority: "runtime" }
  // Invalid arguments are a deterministic tool-side failure; the model must rewrite the call.
  if (error instanceof InvalidArgumentsError) return { error: message, retryable: false, authority: "tool" }
  // Default: a tool-raised failure that a retry or fallback may recover from.
  return { error: message, retryable: true, authority: "tool" }
}

export const resolve = Effect.fn("SessionTools.resolve")(function* (input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
  bypassAgentCheck: boolean
  messages: SessionV1.WithParts[]
  promptOps: TaskPromptOps
}) {
  const tools: Record<string, AITool> = {}
  const run = yield* EffectBridge.make()
  const plugin = yield* Plugin.Service
  const permission = yield* Permission.Service
  const registry = yield* ToolRegistry.Service
  const mcp = yield* MCP.Service
  const truncate = yield* Truncate.Service

  // Fire `tool.execute.error` if `self` fails, then re-propagate the original failure.
  // User-initiated interruptions are handled by the abort path and are not tool failures.
  const onToolError = <A, E, R>(
    self: Effect.Effect<A, E, R>,
    meta: { tool: string; ctx: Tool.Context; args: any },
    authority?: "plugin",
  ) =>
    self.pipe(
      Effect.tapCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : plugin.trigger(
              "tool.execute.error",
              { tool: meta.tool, sessionID: meta.ctx.sessionID, callID: meta.ctx.callID, args: meta.args },
              classifyToolError(Cause.squash(cause), authority),
            ),
      ),
    )

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

  for (const item of yield* registry.tools({
    modelID: ModelV2.ID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.agent,
  })) {
    const schema = ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item))
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args, options) {
        return run.promise(
          Effect.gen(function* () {
            const ctx = context(args, options)
            const meta = { tool: item.id, ctx, args }
            yield* onToolError(
              plugin.trigger(
                "tool.execute.before",
                { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
                { args },
              ),
              meta,
              "plugin",
            )
            const result = yield* onToolError(item.execute(args, ctx), meta)
            const output = {
              ...result,
              attachments: result.attachments?.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
            }
            yield* onToolError(
              plugin.trigger(
                "tool.execute.after",
                { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
                output,
              ),
              meta,
              "plugin",
            )
            if (options.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(options.toolCallId, output)
            }
            return output
          }),
        )
      },
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
          const meta = { tool: key, ctx, args }
          yield* onToolError(
            plugin.trigger(
              "tool.execute.before",
              { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
              { args },
            ),
            meta,
            "plugin",
          )
          const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* onToolError(
            Effect.gen(function* () {
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
            ),
            meta,
          )
          yield* onToolError(
            plugin.trigger(
              "tool.execute.after",
              { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
              result,
            ),
            meta,
            "plugin",
          )

          const textParts: string[] = []
          const attachments: Omit<SessionV1.FilePart, "id" | "sessionID" | "messageID">[] = []
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
