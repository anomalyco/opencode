import type { Plugin } from "@opencode-ai/plugin"

/**
 * OpenCode Prefill Assistant Plugin
 * 
 * This plugin adds intelligent assistant message prefilling to control:
 * - Output format (JSON, code blocks, structured data)
 * - Agent persona maintenance (keep agents in character)
 * - Response conciseness (skip preambles)
 * - Context awareness (debugging, implementation, planning modes)
 * 
 * Based on Anthropic's prefill pattern:
 * https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prefill-claudes-response
 */

export interface PrefillConfig {
  /** Master toggle for prefilling */
  enabled?: boolean
  
  /** Predefined prefill contexts */
  contexts?: {
    /** Force JSON output without preamble - prefills with "{" */
    jsonOutput?: string
    
    /** Force code-only responses - prefills with "```" */
    codeOnly?: string
    
    /** Orchestrator agent role maintenance */
    orchestrator?: string
    
    /** General agent role maintenance */
    general?: string
    
    /** Planning agent role maintenance */
    plan?: string
    
    /** Skip unnecessary preambles */
    concise?: string
    
    /** Technical analysis mode */
    technical?: string
    
    /** Debugging context */
    debugging?: string
    
    /** Custom prefills */
    [key: string]: string | undefined
  }
  
  /** Enable agent-based prefilling */
  agentPrefilling?: boolean
  
  /** Enable pattern detection in user messages */
  patternDetection?: boolean
  
  /** Minimum conversation depth before applying role prefills */
  minDepthForRole?: number
}

const DEFAULT_CONFIG: Required<PrefillConfig> = {
  enabled: true,
  contexts: {
    jsonOutput: "{",
    codeOnly: "```",
    orchestrator: "[Orchestrator]",
    general: "[General Agent]",
    plan: "[Planning Mode - Read Only]",
    concise: "Here's the solution:",
    technical: "Technical analysis:",
    debugging: "[Debug Context]",
  },
  agentPrefilling: true,
  patternDetection: true,
  minDepthForRole: 10,
}

/**
 * Detect if user wants JSON output
 */
function wantsJsonOutput(message: string): boolean {
  return /\b(json|object|structured\s+data)\b/i.test(message)
}

/**
 * Detect if user wants code only
 */
function wantsCodeOnly(message: string): boolean {
  return /\b(code\s+only|just\s+(the\s+)?code|show\s+code)\b/i.test(message)
}

/**
 * Detect if user wants concise response
 */
function wantsConcise(message: string): boolean {
  return /\b(concise|brief|quick|short|summarize)\b/i.test(message)
}

/**
 * Get prefill text based on context
 */
function getPrefill(params: {
  config: Required<PrefillConfig>
  agent: string
  userMessage: string
  conversationDepth: number
  providerID: string
}): string | undefined {
  const { config, agent, userMessage, conversationDepth, providerID } = params
  
  if (!config.enabled) return undefined
  
  // Only apply prefilling to Anthropic models
  if (providerID !== "anthropic") return undefined
  
  // Pattern detection in user message (highest priority)
  if (config.patternDetection) {
    if (wantsJsonOutput(userMessage)) {
      return config.contexts.jsonOutput
    }
    if (wantsCodeOnly(userMessage)) {
      return config.contexts.codeOnly
    }
    if (wantsConcise(userMessage)) {
      return config.contexts.concise
    }
  }
  
  // Agent-based prefilling
  if (config.agentPrefilling && agent) {
    const agentKey = agent.toLowerCase() as keyof typeof config.contexts
    if (config.contexts[agentKey]) {
      return config.contexts[agentKey]
    }
  }
  
  // Role maintenance for long conversations
  if (conversationDepth >= config.minDepthForRole && agent) {
    const roleKey = agent.toLowerCase() as keyof typeof config.contexts
    if (config.contexts[roleKey]) {
      return config.contexts[roleKey]
    }
    // Fallback: generic role marker
    return `[${agent.charAt(0).toUpperCase() + agent.slice(1)}]`
  }
  
  return undefined
}

/**
 * Prefill Assistant Plugin
 */
export const PrefillAssistantPlugin: Plugin = async (ctx) => {
  let config: Required<PrefillConfig> = DEFAULT_CONFIG
  
  return {
    config: async (projectConfig) => {
      // Merge user config with defaults
      const userConfig = (projectConfig as any).prefillAssistant as PrefillConfig | undefined
      if (userConfig) {
        config = {
          ...DEFAULT_CONFIG,
          ...userConfig,
          contexts: {
            ...DEFAULT_CONFIG.contexts,
            ...userConfig.contexts,
          },
        }
      }
    },
    
    "chat.messages": async (input, output) => {
      // Use userText from input
      const userMessageText = input.userText || ""
      
      // Determine prefill
      const prefill = getPrefill({
        config,
        agent: input.agent,
        userMessage: userMessageText,
        conversationDepth: input.conversationDepth,
        providerID: input.provider.id,
      })
      
      // Add prefill as assistant message if determined
      if (prefill) {
        output.messages.push({
          role: "assistant",
          content: prefill,
        })
      }
    },
  }
}

// Export as default for easy importing
export default PrefillAssistantPlugin
