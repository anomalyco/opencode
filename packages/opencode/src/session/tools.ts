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
import { isRecord } from "@/util/record"
import { McpLazyActivation } from "./mcp-lazy"

const LIST_MCP_RESOURCES_TOOL = "list_mcp_resources"
const READ_MCP_RESOURCE_TOOL = "read_mcp_resource"
const MAX_MCP_RESOURCE_BLOB_BYTES = 10 * 1024 * 1024
const SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

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

  const hasMcpResourceServer = Object.values(yield* mcp.clients()).some(
    (client) => !!client.getServerCapabilities()?.resources,
  )
  if (hasMcpResourceServer) {
    tools[LIST_MCP_RESOURCES_TOOL] = tool({
      description:
        "Lists resources provided by connected MCP servers. Resources provide context such as files, database schemas, or application-specific information.",
      inputSchema: jsonSchema(
        ProviderTransform.schema(input.model, {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: "Optional MCP server name. When omitted, lists resources from every connected server.",
            },
          },
          additionalProperties: false,
        }),
      ),
      execute(args, opts) {
        return run.promise(
          Effect.gen(function* () {
            const parsed = parseListMcpResourcesArgs(args)
            const ctx = context(toRecord(args), opts)
            const clients = yield* mcp.clients()
            const resourceServers = Object.entries(clients)
              .filter((entry) => !!entry[1].getServerCapabilities()?.resources)
              .map((entry) => entry[0])
              .sort((a, b) => a.localeCompare(b))
            if (parsed.server && !resourceServers.includes(parsed.server)) {
              throw new Error(
                resourceServers.length === 0
                  ? `MCP server "${parsed.server}" does not support resources`
                  : `MCP server "${parsed.server}" does not support resources. Available resource servers: ${resourceServers.join(", ")}`,
              )
            }
            const permissionPatterns = parsed.server
              ? [`mcp:${parsed.server}:*`]
              : resourceServers.map((server) => `mcp:${server}:*`)
            yield* plugin.trigger(
              "tool.execute.before",
              { tool: LIST_MCP_RESOURCES_TOOL, sessionID: ctx.sessionID, callID: opts.toolCallId },
              { args },
            )
            yield* ctx.ask({
              permission: "read",
              metadata: parsed.server ? { server: parsed.server } : {},
              patterns: permissionPatterns,
              always: permissionPatterns,
            })

            const resources = Object.values(yield* mcp.resources(parsed.server))
            const filtered = resources
              .filter((resource) => !parsed.server || resource.client === parsed.server)
              .toSorted((a, b) =>
                (a.client + "\u0000" + a.name + "\u0000" + a.uri).localeCompare(
                  b.client + "\u0000" + b.name + "\u0000" + b.uri,
                ),
              )
            const content = JSON.stringify({ resources: filtered.map(formatMcpResource) }, null, 2)
            const truncated = yield* truncate.output(content, {}, input.agent)
            const output = {
              title: parsed.server ? `MCP resources: ${parsed.server}` : "MCP resources",
              metadata: {
                count: filtered.length,
                servers: resourceServers,
                ...(parsed.server ? { server: parsed.server } : {}),
                truncated: truncated.truncated,
                ...(truncated.truncated && { outputPath: truncated.outputPath }),
              },
              output: truncated.content,
            }
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: LIST_MCP_RESOURCES_TOOL, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
              output,
            )
            if (opts.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(opts.toolCallId, output)
            }
            return output
          }),
        )
      },
    })

    tools[READ_MCP_RESOURCE_TOOL] = tool({
      description:
        "Read a specific resource from an MCP server using the server name and resource URI. The URI is an MCP identifier and does not need to be a file URL.",
      inputSchema: jsonSchema(
        ProviderTransform.schema(input.model, {
          type: "object",
          properties: {
            server: {
              type: "string",
              description: "MCP server name exactly as returned by list_mcp_resources.",
            },
            uri: {
              type: "string",
              description: "Resource URI to read. Use the exact URI string returned by list_mcp_resources.",
            },
          },
          required: ["server", "uri"],
          additionalProperties: false,
        }),
      ),
      execute(args, opts) {
        return run.promise(
          Effect.gen(function* () {
            const parsed = parseReadMcpResourceArgs(args)
            const ctx = context(toRecord(args), opts)
            const clients = yield* mcp.clients()
            const client = clients[parsed.server]
            if (!client) {
              throw new Error(`MCP server "${parsed.server}" is not connected`)
            }
            if (!client.getServerCapabilities()?.resources) {
              throw new Error(`MCP server "${parsed.server}" does not support resources`)
            }
            yield* plugin.trigger(
              "tool.execute.before",
              { tool: READ_MCP_RESOURCE_TOOL, sessionID: ctx.sessionID, callID: opts.toolCallId },
              { args },
            )
            yield* ctx.ask({
              permission: "read",
              metadata: { server: parsed.server, uri: parsed.uri },
              patterns: [`mcp:${parsed.server}:${parsed.uri}`],
              always: [`mcp:${parsed.server}:*`],
            })

            const content = yield* mcp.readResource(parsed.server, parsed.uri)
            if (!content) throw new Error(`Failed to read MCP resource: ${parsed.server}/${parsed.uri}`)

            const formatted = formatMcpResourceContent(parsed.server, parsed.uri, content)
            const truncated = yield* truncate.output(formatted.text, {}, input.agent)
            const output = {
              title: `MCP resource: ${parsed.uri}`,
              metadata: {
                server: parsed.server,
                uri: parsed.uri,
                contents: formatted.contents,
                attachments: formatted.attachments.length,
                truncated: truncated.truncated,
                ...(truncated.truncated && { outputPath: truncated.outputPath }),
              },
              output: truncated.content,
              attachments: formatted.attachments.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
            }
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: READ_MCP_RESOURCE_TOOL, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
              output,
            )
            if (opts.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(opts.toolCallId, output)
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
      const transformed = ProviderTransform.schema(input.model, { ...schema, properties: schema.properties ?? {} })
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
                  const mime = resource.mimeType ?? "application/octet-stream"
                  const size = base64Size(resource.blob)
                  if (!SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES.has(mime)) {
                    textParts.push(
                      `[Binary MCP resource omitted: ${resource.uri} (${mime}, ${formatBytes(size)}) is not a supported attachment type]`,
                    )
                    continue
                  }
                  if (size > MAX_MCP_RESOURCE_BLOB_BYTES) {
                    textParts.push(
                      `[Binary MCP resource omitted: ${resource.uri} (${mime}, ${formatBytes(size)}) exceeds ${formatBytes(MAX_MCP_RESOURCE_BLOB_BYTES)}]`,
                    )
                    continue
                  }
                  attachments.push({
                    type: "file",
                    mime,
                    url: `data:${mime};base64,${resource.blob}`,
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

function toRecord(value: unknown) {
  if (isRecord(value)) return value
  return {}
}

function parseListMcpResourcesArgs(value: unknown) {
  const args = toRecord(value)
  return { server: optionalString(args, "server") }
}

function parseReadMcpResourceArgs(value: unknown) {
  const args = toRecord(value)
  return { server: requiredString(args, "server"), uri: requiredString(args, "uri") }
}

function optionalString(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "string") throw new Error(`${key} must be a string`)
  return value
}

function requiredString(args: Record<string, unknown>, key: string) {
  const value = optionalString(args, key)
  if (value) return value
  throw new Error(`${key} is required`)
}

function formatMcpResource(resource: MCP.Resource) {
  const result = Object.fromEntries(Object.entries(resource).filter((entry) => entry[0] !== "client"))
  return { ...result, server: resource.client }
}

function formatMcpResourceContent(server: string, uri: string, content: { contents: unknown }) {
  const items = (Array.isArray(content.contents) ? content.contents : [content.contents]).filter(isRecord)
  const text: string[] = []
  const attachments: Omit<SessionV1.FilePart, "id" | "sessionID" | "messageID">[] = []

  for (const item of items) {
    const itemUri = typeof item.uri === "string" ? item.uri : uri
    const mime = typeof item.mimeType === "string" ? item.mimeType : "application/octet-stream"
    if (typeof item.text === "string") {
      text.push(`Resource: ${itemUri}\nMIME: ${mime}\n${item.text}`)
      continue
    }
    if (typeof item.blob === "string") {
      const size = base64Size(item.blob)
      if (!SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES.has(mime)) {
        text.push(
          `[Binary MCP resource omitted: ${itemUri} (${mime}, ${formatBytes(size)}) is not a supported attachment type]`,
        )
        continue
      }
      if (size > MAX_MCP_RESOURCE_BLOB_BYTES) {
        text.push(
          `[Binary MCP resource omitted: ${itemUri} (${mime}, ${formatBytes(size)}) exceeds ${formatBytes(MAX_MCP_RESOURCE_BLOB_BYTES)}]`,
        )
        continue
      }
      text.push(`[Binary MCP resource attached: ${itemUri} (${mime})]`)
      attachments.push({
        type: "file",
        mime,
        url: `data:${mime};base64,${item.blob}`,
        filename: itemUri,
      })
      continue
    }
    text.push(`[MCP resource content without text or blob: ${itemUri}]`)
  }

  return {
    contents: items.length,
    attachments,
    text: text.join("\n\n") || `MCP resource ${uri} from ${server} returned no contents.`,
  }
}

function base64Size(value: string) {
  const trimmed = value.replace(/\s/g, "")
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${Math.ceil(value / (1024 * 1024))} MB`
}

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
