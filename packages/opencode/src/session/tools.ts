import { Agent } from "@/agent/agent"
import { SessionV1 } from "@opencode-ai/core/v1/session"
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
import type { TurnBudget } from "./turn-budget"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import { Effect } from "effect"
import { MessageV2 } from "./message-v2"
import { Session } from "./session"
import { SessionProcessor } from "./processor"
import { PartID, SessionID } from "./schema"
import { EffectBridge } from "@/effect/bridge"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { McpLazyActivation } from "./mcp-lazy"

export const resolve = Effect.fn("SessionTools.resolve")(function* (input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  permissionSessionID?: SessionID
  processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
  bypassAgentCheck: boolean
  messages: SessionV1.WithParts[]
  promptOps: TaskPromptOps
  /**
   * Item 24: the shared turn pool, threaded into every tool context
   * (ctx.extra.turnBudget — the promptOps pattern) so the workflow tool can
   * hand it to the runs this turn starts.
   */
  turnBudget?: TurnBudget.Pool
  /**
   * Item 28: MCP tool loading mode. `eager` (default) registers every MCP
   * tool with its full transformed schema, exactly as before. `lazy` registers
   * NO MCP tools up front — only a synthetic `tool_search` meta-tool plus the
   * session's already-ACTIVATED keys; a tool_search hit activates keys so the
   * NEXT resolve (the prompt loop re-resolves per step) registers them fully.
   * Workflow subagent sessions default to lazy (config workflows.lazy_mcp).
   */
  mcpMode?: "eager" | "lazy"
}) {
  const tools: Record<string, AITool> = {}
  const run = yield* EffectBridge.make()
  const plugin = yield* Plugin.Service
  const permission = yield* Permission.Service
  const registry = yield* ToolRegistry.Service
  const mcp = yield* MCP.Service
  const truncate = yield* Truncate.Service
  const sessions = yield* Session.Service

  // Nested subagents route their permission asks to the root session
  // (permissionSessionID); without attribution UIs and third-party clients
  // would lose WHO asked. Whenever the ask is routed away from this session,
  // attach the origin (asking session, its agent, its depth) to the request
  // metadata. ONE lineage walk per resolve (roots skip it); a failed walk only
  // omits originDepth — an ask must never fail on attribution.
  const origin = yield* Effect.gen(function* () {
    if (input.permissionSessionID === undefined || input.permissionSessionID === input.session.id) return undefined
    const originDepth =
      input.session.parentID === undefined
        ? 1
        : yield* sessions.lineage(input.session.id).pipe(
            Effect.map((chain) => chain.length),
            Effect.catch(() => Effect.succeed(undefined)),
          )
    return {
      originSessionID: input.session.id,
      originAgent: input.agent.name,
      ...(originDepth !== undefined ? { originDepth } : {}),
    }
  })

  const context = (args: Record<string, unknown>, options: ToolExecutionOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: {
      model: input.model,
      bypassAgentCheck: input.bypassAgentCheck,
      promptOps: input.promptOps,
      // Item 24: the shared turn pool (undefined when the turn set none).
      turnBudget: input.turnBudget,
    },
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
          ...(origin ? { metadata: { ...req.metadata, ...origin } } : {}),
          sessionID: input.permissionSessionID ?? input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
        })
        .pipe(Effect.orDie),
  })

  for (const item of yield* registry.tools({
    modelID: ModelV2.ID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.agent,
    // Item 13: ultracode sessions get the workflow tool with the standing
    // "quality over cost" gate instead of the anti-default sentence.
    ultracode: input.session.metadata?.["ultracode"] === true,
  })) {
    const schema = ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item))
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args, options) {
        return run.promise(
          Effect.gen(function* () {
            const ctx = context(args, options)
            yield* plugin.trigger(
              "tool.execute.before",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
              { args },
            )
            const result = yield* item.execute(args, ctx)
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
  }

  // Item 28: the FULL MCP registration (schema transform + permission-ask
  // wrapper + content mapping), extracted from the former inline loop so both
  // modes share it byte-identically: eager registers every tool, lazy only the
  // session's already-activated keys.
  const registerMcpTool = (key: string, item: AITool) =>
    Effect.gen(function* () {
      const execute = item.execute
      if (!execute) return

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
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
              result,
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
    })

  const mcpEntries = Object.entries(yield* mcp.tools())
  // Item 28: lazy mode applies only when MCP servers actually contribute tools
  // (0 servers ⇒ 0 overhead, the tool list is identical to today) and the
  // synthetic name is free (a registry/plugin tool named `tool_search` would
  // collide — fall back to eager defensively; should never happen).
  const lazy = input.mcpMode === "lazy" && mcpEntries.length > 0 && !(TOOL_SEARCH_KEY in tools)
  if (!lazy) {
    for (const [key, item] of mcpEntries) {
      yield* registerMcpTool(key, item)
    }
    return tools
  }

  // Lazy: register ONLY the already-activated keys in full (so a tool the
  // model found last step is really callable this step) ...
  const activation = yield* McpLazyActivation.Service
  const activated = yield* activation.get(input.session.id)
  for (const [key, item] of mcpEntries) {
    if (activated.has(key)) yield* registerMcpTool(key, item)
  }
  // ... and the tool_search meta-tool over a name+description INDEX — the
  // schemas stay untouched until activation, which is the token saving.
  // tool_search itself is read-only and never asks; an ACTIVATED tool keeps
  // the per-key permission ask of the full registration above, so the
  // security posture is unchanged.
  const index = mcpEntries.map(([key, item]) => ({ key, description: item.description ?? "" }))
  tools[TOOL_SEARCH_KEY] = tool({
    description: TOOL_SEARCH_DESCRIPTION,
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords describing the capability you need." },
        max_results: { type: "number", description: "Maximum number of matches to return (default 5, max 10)." },
      },
      required: ["query"],
    }),
    execute(args: { query: string; max_results?: number }) {
      return run.promise(
        Effect.gen(function* () {
          const limit = Math.min(Math.max(1, Math.round(args.max_results ?? 5)), 10)
          const matches = index
            .map((entry) => ({ ...entry, score: toolSearchScore(args.query, entry.key, entry.description) }))
            .filter((entry) => entry.score > 0)
            .toSorted((a, b) => b.score - a.score)
            .slice(0, limit)
          if (matches.length === 0) {
            const available = index.slice(0, 20).map((entry) => entry.key)
            return {
              title: "Tool search",
              metadata: { matches: [] },
              output: [
                `No MCP tools matched "${args.query}".`,
                `Available tools: ${available.join(", ")}${index.length > available.length ? ", …" : ""}`,
                "Try different keywords (tool names and descriptions are searched).",
              ].join("\n"),
            }
          }
          // Activate the hits: the NEXT step's resolve registers them fully.
          yield* activation.add(input.session.id, matches.map((entry) => entry.key))
          const described = yield* Effect.forEach(matches, (entry) =>
            Effect.gen(function* () {
              const item = mcpEntries.find(([key]) => key === entry.key)?.[1]
              const schema = item
                ? yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
                : undefined
              return { name: entry.key, description: entry.description, input_schema: schema }
            }),
          )
          // Cap a pathological schema dump via the shared truncation seam.
          const truncated = yield* truncate.output(JSON.stringify(described, null, 2), {}, input.agent)
          return {
            title: "Tool search",
            metadata: { matches: matches.map((entry) => entry.key) },
            output: [truncated.content, "", "These tools are registered and callable from your next step."].join("\n"),
          }
        }),
      )
    },
    toModelOutput({ output }) {
      return { type: "text", value: (output as { output: string }).output }
    },
  })

  return tools
})

// Item 28: the synthetic meta-tool's reserved name (checked against existing
// registrations before use).
const TOOL_SEARCH_KEY = "tool_search"

const TOOL_SEARCH_DESCRIPTION = [
  "Search the available MCP tools by capability keywords.",
  "MCP tools are loaded lazily in this session: they are NOT in your tool list until you find them here.",
  "A match registers the tool so you can call it from your NEXT step; the result lists name, description, and input schema.",
].join("\n")

// Tokenized substring/word scoring over key + description: exact key match
// scores highest, key substring next, description substring last; a query
// with no matching term scores 0 (excluded).
function toolSearchScore(query: string, key: string, description: string): number {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((term) => term.length > 0)
  if (terms.length === 0) return 0
  const keyLower = key.toLowerCase()
  const haystack = `${keyLower} ${description.toLowerCase()}`
  let score = 0
  for (const term of terms) {
    if (keyLower === term) score += 5
    else if (keyLower.includes(term)) score += 3
    else if (haystack.includes(term)) score += 1
  }
  return score
}

export * as SessionTools from "./tools"
