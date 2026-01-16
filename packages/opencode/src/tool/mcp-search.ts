import z from "zod"
import { Tool } from "./tool"
import { MCP } from "../mcp"
import { Config } from "../config/config"
import { Plugin } from "../plugin"
import DESCRIPTION from "./mcp-search.txt"

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function getJsonSchema(inputSchema: unknown): Record<string, unknown> | undefined {
  if (!inputSchema || typeof inputSchema !== "object") return undefined
  if ("jsonSchema" in inputSchema) return (inputSchema as { jsonSchema: Record<string, unknown> }).jsonSchema
  return inputSchema as Record<string, unknown>
}

function formatJsonSchema(schema: Record<string, unknown>, indent = 0): string {
  const spaces = "  ".repeat(indent)
  const lines: string[] = []
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
  const required = (schema.required as string[]) ?? []

  if (!properties || Object.keys(properties).length === 0) return `${spaces}No parameters required`

  for (const [name, prop] of Object.entries(properties)) {
    const isRequired = required.includes(name)
    const type = prop.type ?? "any"
    const desc = prop.description ?? ""

    lines.push(`${spaces}- **${name}**${isRequired ? " (required)" : " (optional)"}: ${type}`)
    if (desc) lines.push(`${spaces}  ${desc}`)
    if (type === "object" && prop.properties) lines.push(formatJsonSchema(prop as Record<string, unknown>, indent + 1))
    if (prop.enum) lines.push(`${spaces}  Allowed values: ${(prop.enum as string[]).join(", ")}`)
  }

  return lines.join("\n")
}

const parameters = z.object({
  operation: z
    .enum(["list", "search", "describe", "call"])
    .describe("Operation: list (servers), search (tools), describe (tool schema), or call (execute tool)"),
  query: z.string().optional().describe("Search query for filtering tools (used with 'search' operation)"),
  server: z.string().optional().describe("MCP server name (required for 'describe' and 'call' operations)"),
  tool: z.string().optional().describe("Tool name (required for 'describe' and 'call' operations)"),
  args: z.record(z.string(), z.any()).optional().describe("Arguments to pass to the tool (used with 'call' operation)"),
})

export const McpSearchTool = Tool.define<typeof parameters, Record<string, unknown>>("mcp_search", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const cfg = await Config.get()
    const mcpConfig = cfg.mcp ?? {}
    const status = await MCP.status()

    if (params.operation === "list") {
      const servers: Array<{
        name: string
        type: string
        status: string
        tools?: Array<{ name: string; description?: string }>
      }> = []

      for (const [name, config] of Object.entries(mcpConfig)) {
        if (!("type" in config)) continue
        const serverStatus = status[name]
        const server: (typeof servers)[number] = { name, type: config.type, status: serverStatus?.status ?? "unknown" }

        if (serverStatus?.status === "connected") {
          const tools = await MCP.tools()
          const prefix = sanitize(name) + "_"
          server.tools = Object.entries(tools)
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, tool]) => ({ name: key.slice(prefix.length), description: tool.description }))
        }
        servers.push(server)
      }

      if (servers.length === 0) {
        return {
          title: "No MCP servers",
          output: "No MCP servers configured. Add servers to opencode.json.",
          metadata: {},
        }
      }

      const output = servers
        .map((s) => {
          let result = `## ${s.name} (${s.type})\nStatus: ${s.status}`
          if (s.tools?.length)
            result += `\nTools:\n${s.tools.map((t) => `  - ${t.name}: ${t.description ?? "No description"}`).join("\n")}`
          else if (s.status !== "connected") result += `\n(Connect to see available tools)`
          return result
        })
        .join("\n\n")

      return { title: `${servers.length} MCP servers`, output, metadata: { servers: servers.length } }
    }

    if (params.operation === "search") {
      const q = (params.query ?? "").toLowerCase()
      const matches: Array<{ server: string; tool: string; description?: string; connected: boolean }> = []
      const tools = await MCP.tools()

      for (const [serverName, config] of Object.entries(mcpConfig)) {
        if (!("type" in config)) continue
        const serverStatus = status[serverName]

        if (serverStatus?.status === "connected") {
          const prefix = sanitize(serverName) + "_"
          for (const [key, tool] of Object.entries(tools)) {
            if (!key.startsWith(prefix)) continue
            const toolName = key.slice(prefix.length)
            if (!q || key.toLowerCase().includes(q) || tool.description?.toLowerCase().includes(q)) {
              matches.push({ server: serverName, tool: toolName, description: tool.description, connected: true })
            }
          }
        } else if (!q || serverName.toLowerCase().includes(q)) {
          matches.push({
            server: serverName,
            tool: "(not connected)",
            description: `Server not connected.`,
            connected: false,
          })
        }
      }

      if (matches.length === 0) {
        return {
          title: "No matches",
          output: params.query ? `No tools matching "${params.query}"` : "No MCP tools available",
          metadata: {},
        }
      }

      const output = matches
        .map((m) =>
          m.connected
            ? `- ${m.server}/${m.tool}: ${m.description ?? "No description"}`
            : `- ${m.server}: ${m.description}`,
        )
        .join("\n")

      return {
        title: `${matches.length} tools found`,
        output: `Found ${matches.length} tool(s)${params.query ? ` matching "${params.query}"` : ""}:\n\n${output}\n\nYou MUST use describe before calling any of these tools.`,
        metadata: { count: matches.length },
      }
    }

    if (!params.server || !params.tool) {
      throw new Error("Both 'server' and 'tool' parameters are required")
    }

    const config = mcpConfig[params.server]
    if (!config || !("type" in config)) {
      throw new Error(`MCP server "${params.server}" not found in configuration`)
    }

    if (status[params.server]?.status !== "connected") {
      await MCP.connect(params.server)
      const newStatus = await MCP.status()
      if (newStatus[params.server]?.status !== "connected") {
        const s = newStatus[params.server]
        const error = s?.status === "failed" || s?.status === "needs_client_registration" ? s.error : "unknown error"
        throw new Error(`Failed to connect to "${params.server}": ${error}`)
      }
    }

    const tools = await MCP.tools()
    const toolKey = sanitize(params.server) + "_" + sanitize(params.tool)
    const mcpTool = tools[toolKey]

    if (!mcpTool) {
      const available = Object.keys(tools)
        .filter((k) => k.startsWith(sanitize(params.server!) + "_"))
        .map((k) => k.slice(sanitize(params.server!).length + 1))
      throw new Error(
        `Tool "${params.tool}" not found on "${params.server}". Available: ${available.join(", ") || "none"}`,
      )
    }

    if (params.operation === "describe") {
      const jsonSchema = getJsonSchema(mcpTool.inputSchema)
      const schemaOutput = jsonSchema ? formatJsonSchema(jsonSchema) : "No parameters required"

      return {
        title: `${params.server}/${params.tool}`,
        output: `## ${params.server}/${params.tool}\n\n**Description:** ${mcpTool.description ?? "No description"}\n\n**Parameters:**\n${schemaOutput}\n\n**Example:**\n\`\`\`\nmcp_search(operation: "call", server: "${params.server}", tool: "${params.tool}", args: { ... })\n\`\`\``,
        metadata: { server: params.server, tool: params.tool },
      }
    }

    const args = params.args ?? {}
    const jsonSchema = getJsonSchema(mcpTool.inputSchema)
    const required = (jsonSchema?.required as string[]) ?? []
    const missingArgs = required.filter((r) => !(r in args))

    if (Object.keys(args).length === 0 || missingArgs.length > 0) {
      const schemaOutput = jsonSchema ? formatJsonSchema(jsonSchema) : "No schema available"
      const missingInfo = missingArgs.length > 0 ? `\n\n**Missing:** ${missingArgs.join(", ")}` : ""

      return {
        title: "Arguments required",
        output: `Tool "${params.tool}" requires arguments.${missingInfo}\n\n**Tool:** ${params.server}/${params.tool}\n**Description:** ${mcpTool.description ?? "No description"}\n\n**Parameters:**\n${schemaOutput}\n\n**Example:**\nmcp_search(operation: "call", server: "${params.server}", tool: "${params.tool}", args: { ${required.map((r) => `"${r}": ...`).join(", ")} })`,
        metadata: { server: params.server, tool: params.tool, missingArgs },
      }
    }

    await ctx.ask({ permission: toolKey, metadata: {}, patterns: ["*"], always: ["*"] })

    await Plugin.trigger(
      "tool.execute.before",
      { tool: toolKey, sessionID: ctx.sessionID, callID: ctx.callID },
      { args },
    )

    const result = await mcpTool.execute!(args, { toolCallId: ctx.callID ?? "", abortSignal: ctx.abort, messages: [] })

    await Plugin.trigger("tool.execute.after", { tool: toolKey, sessionID: ctx.sessionID, callID: ctx.callID }, result)

    const textParts: string[] = []
    for (const content of result.content) {
      if (content.type === "text") textParts.push(content.text)
      else if (content.type === "image") textParts.push(`[Image: ${content.mimeType}, ${content.data.length} bytes]`)
      else if (content.type === "resource") {
        if (content.resource.text) textParts.push(content.resource.text)
        if (content.resource.blob) textParts.push(`[Resource: ${content.resource.uri}]`)
      }
    }

    return {
      title: `${params.server}/${params.tool}`,
      output: textParts.join("\n\n") || "Success (no output)",
      metadata: { server: params.server, tool: params.tool },
    }
  },
})
