import z from "zod"

/**
 * Configuration for the Claude Agent SDK provider
 */
export const ClaudeAgentConfig = z
  .object({
    /** Model to use (e.g., "claude-sonnet-4") */
    model: z.string().optional(),
    /** Permission mode for SDK tool execution */
    permissionMode: z
      .enum(["default", "acceptEdits", "bypassPermissions", "plan"])
      .optional()
      .default("default"),
    /** List of SDK built-in tools to enable - set to empty array to disable all built-in tools */
    allowedTools: z.array(z.string()).optional(),
    /** Additional system prompt to append */
    systemPrompt: z.string().optional(),
    /** Working directory for the agent */
    cwd: z.string().optional(),
    /** Disable SDK's built-in tools entirely to only use MCP tools */
    disableBuiltInTools: z.boolean().optional(),
    /** MCP servers to pass to SDK (in addition to opencode's configured MCP servers) */
    mcpServers: z
      .record(
        z.string(),
        z.object({
          command: z.string(),
          args: z.array(z.string()).optional(),
          env: z.record(z.string(), z.string()).optional(),
        }),
      )
      .optional(),
  })
  .strict()

export type ClaudeAgentConfig = z.infer<typeof ClaudeAgentConfig>

/**
 * MCP server configuration in Claude Agent SDK format
 */
export interface SDKMcpServerConfig {
  type?: "stdio" | "sse" | "http" | "sdk"
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  name?: string
  instance?: unknown
}

/**
 * State stored for Claude Agent SDK sessions
 */
export interface ClaudeAgentSessionState {
  /** SDK's internal session ID for resume capability */
  sdkSessionId?: string
}

/**
 * Context for message translation
 */
export interface MessageContext {
  sessionID: string
  messageID: string
  partIndex: number
}

/**
 * SDK Permission modes
 */
export type SDKPermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan"

/**
 * Default allowed tools for Claude Agent SDK
 * These map to OpenCode's tools via MCP server
 */
export const DEFAULT_ALLOWED_TOOLS = [
  "opencoderead",
  "opencodewrite",
  "opencodeedit",
  "opencodebash",
  "opencodeglob",
  "opencodegrep",
  "opencodewebsearch",
  "opencodewebfetch",
  "opencodetask",
  "opencodetodowrite",
  "opencodetodoread",
  "opencodequestion",
  "opencodelsp",
  "opencodels",
  "opencodecodesearch",
  "opencodeskill",
  "opencodemultiedit",
  "opencodepatch",
]
