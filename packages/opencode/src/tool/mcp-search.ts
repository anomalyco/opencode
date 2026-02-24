import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import { MCP } from "../mcp"
import { Plugin } from "../plugin"
import { processMcpResult } from "./mcp-result"
import DESCRIPTION from "./mcp-search.txt"

const Parameters = Schema.Struct({
  operation: Schema.Literals(["list", "search", "describe", "call"]).annotate({ description: "Operation to perform" }),
  query: Schema.optional(Schema.String).annotate({ description: "Search query (for 'search' operation)" }),
  server: Schema.optional(Schema.String).annotate({ description: "MCP server name (required for 'describe' and 'call')" }),
  tool: Schema.optional(Schema.String).annotate({ description: "Tool name on that server (required for 'describe' and 'call')" }),
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Tool arguments as a JSON object (for 'call' operation)",
  }),
})

type McpSearchParams = Schema.Schema.Type<typeof Parameters>

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function extractSchema(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object") return undefined
  if ("jsonSchema" in input) return (input as { jsonSchema: Record<string, unknown> }).jsonSchema
  return input as Record<string, unknown>
}

function formatSchema(schema: Record<string, unknown>, indent = 0): string {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
  const required = new Set((schema.required as string[]) ?? [])
  if (!properties || Object.keys(properties).length === 0) return "  ".repeat(indent) + "No parameters required"

  const pad = "  ".repeat(indent)
  return Object.entries(properties)
    .flatMap(([name, prop]) => {
      const lines = [`${pad}- **${name}**${required.has(name) ? " (required)" : " (optional)"}: ${prop.type ?? "any"}`]
      if (prop.description) lines.push(`${pad}  ${prop.description}`)
      if (prop.type === "object" && prop.properties) lines.push(formatSchema(prop, indent + 1))
      if (prop.enum) lines.push(`${pad}  Allowed values: ${(prop.enum as string[]).join(", ")}`)
      return lines
    })
    .join("\n")
}

function getServers(mcp: MCP.Interface) {
  return Effect.gen(function* () {
    const [status, allTools] = yield* Effect.all([mcp.status(), mcp.tools()])
    const toolEntries = Object.entries(allTools)
    return Object.entries(status)
      .filter(([, s]) => s.status === "connected")
      .map(([name]) => {
        const prefix = sanitize(name) + "_"
        const tools = toolEntries
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, tool]) => ({ name: key.slice(prefix.length), description: tool.description }))
        return { name, tools }
      })
  })
}

function doList(mcp: MCP.Interface) {
  return Effect.gen(function* () {
    const servers = yield* getServers(mcp)
    if (servers.length === 0)
      return { title: "No MCP servers", output: "No connected MCP servers.", metadata: {} }

    const output = servers
      .map((s) => `## ${s.name}\n${s.tools.map((t) => `- ${t.name}: ${t.description ?? "No description"}`).join("\n")}`)
      .join("\n\n")

    return { title: `${servers.length} MCP servers`, output, metadata: { servers: servers.length } }
  })
}

function doSearch(mcp: MCP.Interface, query?: string) {
  return Effect.gen(function* () {
    const servers = yield* getServers(mcp)
    const q = query?.toLowerCase() ?? ""

    const matches = servers.flatMap((s) => {
      if (!q) return s.tools.map((t) => ({ server: s.name, ...t }))
      if (s.name.toLowerCase().includes(q)) return s.tools.map((t) => ({ server: s.name, ...t }))
      const filtered = s.tools.filter(
        (t) => t.name.toLowerCase().includes(q) || (t.description?.toLowerCase().includes(q) ?? false),
      )
      return filtered.map((t) => ({ server: s.name, ...t }))
    })

    if (matches.length === 0) {
      return {
        title: "No matches",
        output: query ? `No tools matching "${query}"` : "No MCP tools available",
        metadata: {},
      }
    }

    const output = matches.map((m) => `- ${m.server}/${m.name}: ${m.description ?? "No description"}`).join("\n")
    return {
      title: `${matches.length} tools found`,
      output: `Found ${matches.length} tool(s)${query ? ` matching "${query}"` : ""}:\n\n${output}\n\nYou MUST use describe before calling any of these tools.`,
      metadata: { count: matches.length },
    }
  })
}

function resolveTool(mcp: MCP.Interface, server: string, toolName: string) {
  return Effect.gen(function* () {
    const [status, allTools] = yield* Effect.all([mcp.status(), mcp.tools()])

    if (status[server]?.status !== "connected")
      throw new Error(`MCP server "${server}" is not connected`)

    const prefix = sanitize(server)
    const key = `${prefix}_${sanitize(toolName)}`
    const mcpTool = allTools[key]

    if (!mcpTool) {
      const available = Object.keys(allTools)
        .filter((k) => k.startsWith(prefix + "_"))
        .map((k) => k.slice(prefix.length + 1))
      throw new Error(`Tool "${toolName}" not found on "${server}". Available: ${available.join(", ") || "none"}`)
    }

    return { key, mcpTool }
  })
}

function doDescribe(mcp: MCP.Interface, server: string, toolName: string) {
  return Effect.gen(function* () {
    const { mcpTool } = yield* resolveTool(mcp, server, toolName)
    const schema = extractSchema(mcpTool.inputSchema)

    return {
      title: `${server}/${toolName}`,
      output: [
        `## ${server}/${toolName}`,
        "",
        `**Description:** ${mcpTool.description ?? "No description"}`,
        "",
        "**Parameters:**",
        schema ? formatSchema(schema) : "No parameters required",
        "",
        "**Example:**",
        "```",
        `mcp_search(operation: "call", server: "${server}", tool: "${toolName}", args: { ... })`,
        "```",
      ].join("\n"),
      metadata: { server, tool: toolName },
    }
  })
}

function doCall(
  mcp: MCP.Interface,
  plugin: Plugin.Interface,
  server: string,
  toolName: string,
  args: Record<string, unknown>,
  ctx: Tool.Context,
) {
  return Effect.gen(function* () {
    const { key, mcpTool } = yield* resolveTool(mcp, server, toolName)
    const schema = extractSchema(mcpTool.inputSchema)
    const required = (schema?.required as string[]) ?? []
    const missing = required.filter((r) => !(r in args))

    if (missing.length > 0) {
      return {
        title: "Arguments required",
        output: [
          `Tool "${toolName}" requires arguments.`,
          "",
          `**Missing:** ${missing.join(", ")}`,
          "",
          `**Tool:** ${server}/${toolName}`,
          `**Description:** ${mcpTool.description ?? "No description"}`,
          "",
          "**Parameters:**",
          schema ? formatSchema(schema) : "No schema available",
          "",
          "**Example:**",
          `mcp_search(operation: "call", server: "${server}", tool: "${toolName}", args: { ${required.map((r) => `"${r}": ...`).join(", ")} })`,
        ].join("\n"),
        metadata: { server, tool: toolName, missing },
      }
    }

    yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
    yield* plugin.trigger(
      "tool.execute.before",
      { tool: key, sessionID: ctx.sessionID, callID: ctx.callID },
      { args },
    )

    const execute = mcpTool.execute
    if (!execute) throw new Error(`Tool "${toolName}" on "${server}" has no execute function`)

    const result = yield* Effect.promise(() =>
      execute(args, { toolCallId: ctx.callID ?? "", abortSignal: ctx.abort, messages: [] }),
    )

    yield* plugin.trigger(
      "tool.execute.after",
      { tool: key, sessionID: ctx.sessionID, callID: ctx.callID, args },
      result as any,
    )

    const processed = processMcpResult(result as any)

    return {
      title: `${server}/${toolName}`,
      output: processed.output || "Success (no output)",
      metadata: { ...processed.metadata, server, tool: toolName },
      attachments: processed.attachments,
    }
  })
}

export const McpSearchTool = Tool.define(
  "mcp_search",
  Effect.gen(function* () {
    const mcp = yield* MCP.Service
    const plugin = yield* Plugin.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute(params: McpSearchParams, ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<Record<string, unknown>>> {
        const raw = params as McpSearchParams & Record<string, unknown>
        const server = raw.server ?? (raw as any).mcp_name ?? (raw as any).server_name
        const tool = raw.tool ?? (raw as any).tool_name ?? (raw as any).name
        const args: Record<string, unknown> | undefined = raw.args ?? (typeof (raw as any).arguments === "string" ? JSON.parse((raw as any).arguments) : (raw as any).arguments)
        return Effect.gen(function* () {
          if (raw.operation === "list") return yield* doList(mcp) as any
          if (raw.operation === "search") return yield* doSearch(mcp, raw.query) as any
          if (!server || !tool)
            throw new Error(`Both 'server' and 'tool' parameters are required. Received: server=${JSON.stringify(server)}, tool=${JSON.stringify(tool)}. Use parameter names "server" and "tool", not "mcp_name" or "tool_name".`)
          if (raw.operation === "describe") return yield* doDescribe(mcp, server, tool) as any
          return yield* doCall(mcp, plugin, server, tool, args ?? {}, ctx) as any
        }) as any
      },
    }
  }),
)
