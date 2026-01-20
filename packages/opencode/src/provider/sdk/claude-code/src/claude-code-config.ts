export interface ClaudeCodeConfig {
  provider: string
  cliPath: string
  cwd?: string
  sessionId?: string
  skipPermissions?: boolean

  /**
   * When true, permission-requiring tools (Edit, Write, Bash, etc.) will be handled
   * by OpenCode instead of Claude CLI. This enables OpenCode's permission UI to be
   * used for these tools. Claude CLI will still handle read-only tools.
   * When enabled, --dangerously-skip-permissions is automatically used to prevent
   * Claude CLI from blocking on its own permission prompts.
   */
  handleToolsInOpenCode?: boolean

  /**
   * Permission mode to use with Claude CLI.
   * - "default": Standard permission behavior, triggers permissionHandler
   * - "acceptEdits": Auto-accept file edits and filesystem operations
   * - "bypassPermissions": Skip all permission checks (same as skipPermissions: true)
   * - "plan": Planning mode, no tool execution
   */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan"

  /**
   * Called when Claude CLI requests permission.
   * @param request - The permission request details
   * @param sessionID - The OpenCode session ID (from providerOptions)
   * @returns true to approve, false to deny
   */
  permissionHandler?: (request: ClaudePermissionRequest, sessionID?: string) => Promise<boolean>

  /**
   * Called when Claude CLI asks a question (AskUserQuestion tool).
   * @param input - The question input (question, options, etc.)
   * @param sessionID - The OpenCode session ID
   * @returns The user's answer
   */
  questionHandler?: (
    input: { question: string; options?: any[]; custom?: boolean; multiple?: boolean },
    sessionID?: string,
  ) => Promise<string>
}

/**
 * Future: MCP Permission Server approach
 *
 * Claude CLI supports delegating permission decisions to an MCP server via the
 * `--permission-prompt-tool` flag. This is the cleanest way to integrate with
 * OpenCode's permission UI:
 *
 * 1. Spawn an MCP server that exposes a `permission_prompt` tool
 * 2. Pass `--permission-prompt-tool mcp__server__permission_prompt` to Claude CLI
 * 3. When Claude needs permission, it calls the MCP tool with:
 *    { tool_use_id, tool_name, input }
 * 4. MCP server calls OpenCode's permissionHandler
 * 5. Returns { behavior: "allow" } or { behavior: "deny", message: "..." }
 *
 * This approach allows Claude CLI to properly wait for permission approval
 * before executing tools.
 */

export interface ClaudePermissionRequest {
  id: string
  type: string
  tool?: string
  path?: string
  command?: string
  description?: string
}
