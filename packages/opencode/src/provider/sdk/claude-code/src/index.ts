import type { LanguageModelV2, ProviderV2 } from "@ai-sdk/provider"
import { ClaudeCodeLanguageModel } from "./claude-code-language-model"
import type { ClaudePermissionRequest } from "./claude-code-config"

export interface ClaudeCodeProviderSettings {
  cliPath?: string
  cwd?: string
  sessionId?: string
  name?: string
  skipPermissions?: boolean
  /**
   * When true (default), permission-requiring tools (Edit, Write, Bash, etc.) will be
   * handled by OpenCode instead of Claude CLI. This enables OpenCode's permission UI.
   * Set to false to let Claude CLI handle all tool execution internally.
   * @default true
   */
  handleToolsInOpenCode?: boolean
  /**
   * Permission mode to use with Claude CLI.
   * - "default": Standard permission behavior
   * - "acceptEdits": Auto-accept file edits and filesystem operations
   * - "bypassPermissions": Skip all permission checks
   * - "plan": Planning mode, no tool execution
   */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan"
  permissionHandler?: (request: ClaudePermissionRequest, sessionID?: string) => Promise<boolean>
  questionHandler?: (
    input: { question: string; options?: any[]; custom?: boolean; multiple?: boolean },
    sessionID?: string,
  ) => Promise<string>
}

export interface ClaudeCodeProvider extends ProviderV2 {
  (modelId: string): LanguageModelV2
  languageModel(modelId: string): LanguageModelV2
}

export function createClaudeCode(settings: ClaudeCodeProviderSettings = {}): ClaudeCodeProvider {
  const cliPath = settings.cliPath ?? process.env.CLAUDE_CLI_PATH ?? "claude"
  const cwd = settings.cwd ?? process.cwd()
  const providerName = settings.name ?? "claude-code"

  const createModel = (modelId: string): LanguageModelV2 => {
    return new ClaudeCodeLanguageModel(modelId, {
      provider: providerName,
      cliPath,
      cwd,
      sessionId: settings.sessionId,
      skipPermissions: settings.skipPermissions,
      // Default to true: route permission-requiring tools to OpenCode for proper permission UI
      handleToolsInOpenCode: settings.handleToolsInOpenCode ?? true,
      permissionMode: settings.permissionMode,
      permissionHandler: settings.permissionHandler,
      questionHandler: settings.questionHandler,
    })
  }

  const provider = function (modelId: string) {
    return createModel(modelId)
  } as ClaudeCodeProvider

  provider.languageModel = createModel

  return provider
}

export { ClaudeCodeLanguageModel } from "./claude-code-language-model"
export type { ClaudeCodeConfig, ClaudePermissionRequest } from "./claude-code-config"
