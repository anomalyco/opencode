import type { Provider } from "@/provider/provider"
import { ClaudeAgentConfig, DEFAULT_ALLOWED_TOOLS } from "./types"

/**
 * Claude Agent SDK Provider
 *
 * This provider uses @anthropic-ai/claude-agent-sdk for agent execution,
 * which includes built-in tool execution and MCP server support.
 */
export namespace ClaudeAgentProvider {
  export const ID = "claude-agent"

  /**
   * Check if a provider ID is the Claude Agent provider
   */
  export function isClaudeAgentProvider(providerID: string): boolean {
    return providerID === ID
  }

  /**
   * Create default model configuration
   */
  function createModel(
    id: string,
    name: string,
    apiId: string,
    options: Partial<{
      context: number
      output: number
      costInput: number
      costOutput: number
    }> = {},
  ): Provider.Model {
    const { context = 200000, output = 16384, costInput = 3, costOutput = 15 } = options

    return {
      id,
      providerID: ID,
      name,
      family: "claude",
      api: {
        id: apiId,
        url: "https://api.anthropic.com/v1",
        npm: "@anthropic-ai/claude-agent-sdk",
      },
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: true,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: {
          field: "reasoning_content",
        },
      },
      cost: {
        input: costInput,
        output: costOutput,
        cache: {
          read: costInput * 0.1,
          write: costInput * 1.25,
        },
      },
      limit: {
        context,
        output,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2025-01-01",
    }
  }

  /**
   * Provider info for Claude Agent SDK
   */
  export const Info: Provider.Info = {
    id: ID,
    name: "Claude Agent SDK",
    source: "custom",
    env: ["ANTHROPIC_API_KEY"],
    options: {},
    models: {
      "claude-sonnet-4": createModel("claude-sonnet-4", "Claude Sonnet 4 (Agent SDK)", "claude-sonnet-4-20250514", {
        context: 200000,
        output: 16384,
        costInput: 3,
        costOutput: 15,
      }),
      "claude-opus-4": createModel("claude-opus-4", "Claude Opus 4 (Agent SDK)", "claude-opus-4-20250514", {
        context: 200000,
        output: 32768,
        costInput: 15,
        costOutput: 75,
      }),
      "claude-haiku-3.5": createModel(
        "claude-haiku-3.5",
        "Claude Haiku 3.5 (Agent SDK)",
        "claude-3-5-haiku-20241022",
        {
          context: 200000,
          output: 8192,
          costInput: 0.8,
          costOutput: 4,
        },
      ),
    },
  }

  /**
   * Get the default configuration for Claude Agent SDK
   */
  export function getDefaultConfig(): ClaudeAgentConfig {
    return {
      permissionMode: "default",
      allowedTools: DEFAULT_ALLOWED_TOOLS,
    }
  }

  /**
   * Validate and merge user config with defaults
   */
  export function mergeConfig(userConfig?: Partial<ClaudeAgentConfig>): ClaudeAgentConfig {
    const defaults = getDefaultConfig()
    return {
      ...defaults,
      ...userConfig,
      allowedTools: userConfig?.allowedTools ?? defaults.allowedTools,
    }
  }
}

export { ClaudeAgentAdapter } from "./adapter"
export { ClaudeAgentSession } from "./session-handler"
export { ClaudeAgentConfig, DEFAULT_ALLOWED_TOOLS } from "./types"
export { PermissionBridge } from "./permission-bridge"
export { QuestionBridge } from "./question-bridge"
export { ToolMCPBridge } from "./tool-mcp-bridge"
