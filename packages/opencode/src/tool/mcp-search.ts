import z from "zod"
import { Tool } from "./tool"
import { MCP } from "../mcp"
import { Plugin } from "../plugin"
import DESCRIPTION from "./mcp-search.txt"

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

const parameters = z.object({
  operation: z.enum(["list", "search", "describe", "call"]).describe("Operation to perform"),
  query: z.string().optional().describe("Search query (for 'search')"),
  server: z.string().optional().describe("MCP server name (for 'describe'/'call')"),
  tool: z.string().optional().describe("Tool name (for 'describe'/'call')"),
  args: z.record(z.string(), z.any()).optional().describe("Tool arguments (for 'call')"),
})

async function getConnectedServers() {
  const [status, allTools] = await Promise.all([MCP.status(), MCP.tools()])
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
}

async function resolveTool(server: string, tool: string) {
  const [status, allTools] = await Promise.all([MCP.status(), MCP.tools()])

  if (status[server]?.status !== "connected") throw new Error(`MCP server "${server}" is not connected`)

  const prefix = sanitize(server)
  const key = `${prefix}_${sanitize(tool)}`
  const mcpTool = allTools[key]

  if (mcpTool) return { key, mcpTool }

  const available = Object.keys(allTools)
    .filter((k) => k.startsWith(prefix + "_"))
    .map((k) => k.slice(prefix.length + 1))
  throw new Error(`Tool "${tool}" not found on "${server}". Available: ${available.join(", ") || "none"}`)
}

async function list() {
  const servers = await getConnectedServers()
  if (servers.length === 0) return { title: "No MCP servers", output: "No connected MCP servers.", metadata: {} }

  const output = servers
    .map((s) => `## ${s.name}\n${s.tools.map((t) => `- ${t.name}: ${t.description ?? "No description"}`).join("\n")}`)
    .join("\n\n")

  return { title: `${servers.length} MCP servers`, output, metadata: { servers: servers.length } }
}

async function search(query?: string) {
  const servers = await getConnectedServers()
  const q = query?.toLowerCase() ?? ""

  const matches = servers.flatMap((s) => {
    if (q && !s.name.toLowerCase().includes(q)) return []
    return s.tools.map((t) => ({ server: s.name, ...t }))
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
}

async function describe(server: string, tool: string) {
  const { mcpTool } = await resolveTool(server, tool)
  const schema = extractSchema(mcpTool.inputSchema)

  return {
    title: `${server}/${tool}`,
    output: [
      `## ${server}/${tool}`,
      "",
      `**Description:** ${mcpTool.description ?? "No description"}`,
      "",
      "**Parameters:**",
      schema ? formatSchema(schema) : "No parameters required",
      "",
      "**Example:**",
      "```",
      `mcp_search(operation: "call", server: "${server}", tool: "${tool}", args: { ... })`,
      "```",
    ].join("\n"),
    metadata: { server, tool },
  }
}

async function call(server: string, tool: string, args: Record<string, unknown>, ctx: Tool.Context) {
  const { key, mcpTool } = await resolveTool(server, tool)
  const schema = extractSchema(mcpTool.inputSchema)
  const required = (schema?.required as string[]) ?? []
  const missing = required.filter((r) => !(r in args))

  if (missing.length > 0) {
    return {
      title: "Arguments required",
      output: [
        `Tool "${tool}" requires arguments.`,
        "",
        `**Missing:** ${missing.join(", ")}`,
        "",
        `**Tool:** ${server}/${tool}`,
        `**Description:** ${mcpTool.description ?? "No description"}`,
        "",
        "**Parameters:**",
        schema ? formatSchema(schema) : "No schema available",
        "",
        "**Example:**",
        `mcp_search(operation: "call", server: "${server}", tool: "${tool}", args: { ${required.map((r) => `"${r}": ...`).join(", ")} })`,
      ].join("\n"),
      metadata: { server, tool, missing },
    }
  }

  await ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
  await Plugin.trigger("tool.execute.before", { tool: key, sessionID: ctx.sessionID, callID: ctx.callID }, { args })

  const result = await mcpTool.execute!(args, { toolCallId: ctx.callID ?? "", abortSignal: ctx.abort, messages: [] })

  await Plugin.trigger("tool.execute.after", { tool: key, sessionID: ctx.sessionID, callID: ctx.callID }, result)

  const parts: string[] = []
  for (const c of result.content) {
    if (c.type === "text") parts.push(c.text)
    else if (c.type === "image") parts.push(`[Image: ${c.mimeType}, ${c.data.length} bytes]`)
    else if (c.type === "resource") parts.push(c.resource.text ?? `[Resource: ${c.resource.uri}]`)
  }
  const output = parts.join("\n\n")

  return { title: `${server}/${tool}`, output: output || "Success (no output)", metadata: { server, tool } }
}

export const McpSearchTool = Tool.define<typeof parameters, Record<string, unknown>>("mcp_search", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    if (params.operation === "list") return list()
    if (params.operation === "search") return search(params.query)
    if (!params.server || !params.tool) throw new Error("Both 'server' and 'tool' parameters are required")
    if (params.operation === "describe") return describe(params.server, params.tool)
    return call(params.server, params.tool, params.args ?? {}, ctx)
  },
})
