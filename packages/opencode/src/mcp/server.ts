import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js"
import z from "zod/v4"
import { ToolRegistry } from "../tool/registry"
import { Tool } from "../tool/tool"
import { Wildcard } from "../util/wildcard"
import { Log } from "../util/log"
import { Config } from "../config/config"
import { randomUUID } from "crypto"

export namespace McpServer {
  const log = Log.create({ service: "mcp.server" })

  /**
   * Options for starting the MCP server
   */
  export interface Options {
    /** Project working directory */
    cwd: string
  }

  /**
   * Cached tool definition with initialized parameters
   */
  interface CachedTool {
    id: string
    description: string
    parameters: z.ZodType
    jsonSchema: Record<string, unknown>
    execute: Awaited<ReturnType<Tool.Info["init"]>>["execute"]
  }

  /**
   * Start the MCP server in stdio mode
   *
   * This server exposes only custom tools (from `.opencode/tool/*.{js,ts}` and plugins).
   * Built-in tools (bash, read, write, etc.) are NOT exposed.
   */
  export async function start(options: Options): Promise<void> {
    const config = await Config.get()
    const mcpServerConfig = config.mcpServer ?? {}

    // Generate a stable session ID for this server instance
    const serverSessionID = randomUUID()

    // Load and cache custom tools
    const registryState = await ToolRegistry.state()
    const customTools = registryState.custom

    // Filter tools based on config
    const toolsConfig = mcpServerConfig.tools ?? {}
    const enabledTools: CachedTool[] = []

    for (const toolInfo of customTools) {
      // Check if tool is enabled via wildcard config
      // If tools config is empty/undefined, all tools are enabled by default
      const isEnabled =
        Object.keys(toolsConfig).length === 0 ? true : Wildcard.all(toolInfo.id, toolsConfig) !== false

      if (!isEnabled) {
        log.debug("tool disabled by config", { toolId: toolInfo.id })
        continue
      }

      try {
        // Initialize tool and cache result
        const initialized = await toolInfo.init()
        const jsonSchema = convertZodToJsonSchema(initialized.parameters)

        enabledTools.push({
          id: toolInfo.id,
          description: initialized.description,
          parameters: initialized.parameters,
          jsonSchema,
          execute: initialized.execute,
        })

        log.debug("tool loaded", { toolId: toolInfo.id })
      } catch (error) {
        log.error("failed to initialize tool", {
          toolId: toolInfo.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    log.info("starting mcp server", {
      cwd: options.cwd,
      toolCount: enabledTools.length,
      toolIds: enabledTools.map((t) => t.id),
    })

    // Create MCP server
    const server = new Server(
      {
        name: "opencode",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    )

    // Handle listTools request
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: enabledTools.map((tool) => ({
          name: tool.id,
          description: tool.description,
          inputSchema: tool.jsonSchema,
        })),
      }
    })

    // Handle callTool request
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const tool = enabledTools.find((t) => t.id === toolName)

      if (!tool) {
        throw new McpError(ErrorCode.InvalidParams, `Tool "${toolName}" not found`)
      }

      // Create synthetic context for tool execution
      const messageID = randomUUID()
      const abortController = new AbortController()

      const ctx: Tool.Context = {
        sessionID: serverSessionID,
        messageID,
        agent: "mcp-server",
        abort: abortController.signal,
        metadata: () => {
          // No-op in MCP server mode - metadata updates are not supported
        },
      }

      try {
        // Parse and validate arguments
        const args = request.params.arguments ?? {}
        const parsedArgs = tool.parameters.parse(args)

        // Execute tool
        const result = await tool.execute(parsedArgs, ctx)

        // Log if attachments are present (v1 skips them)
        if (result.attachments && result.attachments.length > 0) {
          log.debug("tool returned attachments (skipped in v1)", {
            toolId: toolName,
            attachmentCount: result.attachments.length,
          })
        }

        // Return text-only response
        return {
          content: [
            {
              type: "text" as const,
              text: result.output,
            },
          ],
        }
      } catch (error) {
        // Safe error handling - no stack traces to client
        const message = error instanceof Error ? error.message : "Tool execution failed"

        log.error("tool execution failed", {
          toolId: toolName,
          error: message,
        })

        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${message}`,
            },
          ],
          isError: true,
        }
      }
    })

    // Create stdio transport and connect
    const transport = new StdioServerTransport()
    await server.connect(transport)

    log.info("mcp server connected and ready")

    // Keep server running until process exits
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        log.info("received SIGINT, shutting down")
        server.close().finally(resolve)
      })
      process.on("SIGTERM", () => {
        log.info("received SIGTERM, shutting down")
        server.close().finally(resolve)
      })
    })
  }

  /**
   * Get list of tools that would be exposed by the MCP server
   * Useful for --list dry-run mode
   */
  export async function listTools(): Promise<Array<{ id: string; description: string }>> {
    const config = await Config.get()
    const mcpServerConfig = config.mcpServer ?? {}

    const registryState = await ToolRegistry.state()
    const customTools = registryState.custom

    const toolsConfig = mcpServerConfig.tools ?? {}
    const result: Array<{ id: string; description: string }> = []

    for (const toolInfo of customTools) {
      const isEnabled =
        Object.keys(toolsConfig).length === 0 ? true : Wildcard.all(toolInfo.id, toolsConfig) !== false

      if (!isEnabled) {
        continue
      }

      try {
        const initialized = await toolInfo.init()
        result.push({
          id: toolInfo.id,
          description: initialized.description,
        })
      } catch {
        // Skip tools that fail to initialize
      }
    }

    return result
  }

  /**
   * Convert Zod schema to JSON Schema
   * Uses Zod v4's built-in toJSONSchema method
   */
  function convertZodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
    try {
      const jsonSchema = z.toJSONSchema(schema)
      // Ensure it's always an object type for MCP compatibility
      return {
        type: "object",
        ...jsonSchema,
      }
    } catch (error) {
      log.warn("failed to convert zod schema to json schema", {
        error: error instanceof Error ? error.message : String(error),
      })
      // Return empty object schema as fallback
      return {
        type: "object",
        properties: {},
      }
    }
  }
}
