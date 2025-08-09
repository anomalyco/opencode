import { App } from "../app/app"
import { Log } from "../util/log"
import { ToolRegistry } from "./registry"
import { MCP } from "../mcp"
import { z } from "zod"

export namespace ToolService {
  const log = Log.create({ service: "tool-service" })

  export const ToolInfo = z.object({
    name: z.string(),
    description: z.string().optional(),
    source: z.enum(["builtin", "mcp"]),
    defaultEnabled: z.boolean().optional().default(true), // NEW: explicit default enabled flag
  })
  export type ToolInfo = z.infer<typeof ToolInfo>

  // Tool-specific metadata - documents why certain tools are disabled by default
  const TOOL_DEFAULTS: Record<string, { defaultEnabled: boolean; reason?: string }> = {
    patch: { defaultEnabled: false, reason: "Experimental/deprecated tool marked 'do not use'" },
    invalid: { defaultEnabled: false, reason: "Internal error handling tool" },
  }

  const state = App.state("tool-service", async () => {
    return {
      cache: new Map<string, Record<string, ToolInfo>>(),
      cacheTimestamps: new Map<string, number>(),
    }
  })

  const CACHE_TTL = 60 * 1000 // 1 minute

  export async function getAllTools(): Promise<Record<string, ToolInfo>> {
    const cacheKey = "all-tools"
    const serviceState = await state()
    const now = Date.now()

    // Check cache first
    const cached = serviceState.cache.get(cacheKey)
    const cacheTime = serviceState.cacheTimestamps.get(cacheKey) ?? 0

    if (cached && now - cacheTime < CACHE_TTL) {
      log.debug("returning cached tools", { count: Object.keys(cached).length })
      return cached
    }

    log.debug("fetching fresh tools")
    const tools: Record<string, ToolInfo> = {}

    // Add built-in tools dynamically from registry
    try {
      const builtinTools = await ToolRegistry.tools("", "") // provider/model not needed for getting tool info
      for (const tool of builtinTools) {
        const defaults = TOOL_DEFAULTS[tool.id]
        tools[tool.id] = {
          name: tool.id,
          description: tool.description,
          source: "builtin",
          defaultEnabled: defaults?.defaultEnabled ?? true, // Use metadata or default to true
        }
      }
    } catch (error) {
      log.warn("Failed to load builtin tools, falling back to IDs", { error })
      // Fallback to just tool IDs if registry fails
      const builtinToolIds = ToolRegistry.ids()
      for (const toolName of builtinToolIds) {
        const defaults = TOOL_DEFAULTS[toolName]
        tools[toolName] = {
          name: toolName,
          source: "builtin",
          defaultEnabled: defaults?.defaultEnabled ?? true,
        }
      }
    }

    // Add MCP tools (always enabled by default since they're explicitly configured)
    try {
      const mcpTools = await MCP.tools()
      for (const [toolName, tool] of Object.entries(mcpTools)) {
        tools[toolName] = {
          name: toolName,
          description: tool.description,
          source: "mcp",
          defaultEnabled: true, // MCP tools are always enabled by default
        }
      }
    } catch (error) {
      // MCP tools might not be available, that's okay
      log.debug("MCP tools not available", { error })
    }

    // Update cache
    serviceState.cache.set(cacheKey, tools)
    serviceState.cacheTimestamps.set(cacheKey, now)

    log.debug("cached fresh tools", { count: Object.keys(tools).length })
    return tools
  }

  export function isToolDefaultEnabled(name: string): boolean {
    const defaults = TOOL_DEFAULTS[name]
    return defaults?.defaultEnabled ?? true
  }

  export async function getToolDefaults(): Promise<Record<string, boolean>> {
    const allTools = await getAllTools()
    const result: Record<string, boolean> = {}

    for (const [name, tool] of Object.entries(allTools)) {
      result[name] = tool.defaultEnabled ?? true
    }

    return result
  }

  export async function invalidateCache(): Promise<void> {
    const serviceState = await state()
    serviceState.cache.clear()
    serviceState.cacheTimestamps.clear()
    log.debug("cache invalidated")
  }
}
