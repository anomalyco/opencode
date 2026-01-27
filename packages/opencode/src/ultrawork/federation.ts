/**
 * ULTRAWORK Federation - AI Fleet Management
 *
 * Manages connections to the user's entire AI subscription fleet.
 * Each AI service is registered as a federation member with its
 * capabilities, strengths, costs, and connection method.
 *
 * Supports three connection channels:
 * - API: Direct API calls (fastest, most reliable)
 * - CLI: Command-line tools (Gemini CLI, Codex CLI, etc.)
 * - Browser: Web automation via Playwright (for web-only UIs)
 */

import { Log } from "../util/log"
import z from "zod"

export const ConnectionType = z.enum(["api", "cli", "browser"])
export type ConnectionType = z.infer<typeof ConnectionType>

export const AICapability = z.enum([
  "coding",
  "reasoning",
  "research",
  "multimodal",
  "realtime_data",
  "math",
  "i18n",
  "creative",
  "architecture",
  "testing",
  "documentation",
  "optimization",
  "security",
  "data_analysis",
  "web_browsing",
  "image_generation",
  "voice",
])
export type AICapability = z.infer<typeof AICapability>

export interface FederationMember {
  id: string
  name: string
  provider: string
  connectionType: ConnectionType
  strengths: AICapability[]
  weaknesses: AICapability[]
  costTier: "free" | "low" | "medium" | "high" | "premium"
  contextWindow: number
  maxOutputTokens: number
  supportsStreaming: boolean
  supportsToolCalling: boolean
  apiEndpoint?: string
  cliCommand?: string
  browserUrl?: string
  envKeys: string[]
  enabled: boolean
  priority: number // lower = preferred when capabilities match
  modelId: string
}

export namespace UltraworkFederation {
  const log = Log.create({ service: "ultrawork.federation" })

  /**
   * The complete AI federation fleet.
   * Each member is configured with its real capabilities and connection details.
   */
  const FEDERATION_MEMBERS: FederationMember[] = [
    // === CLAUDE OPUS 4.5 - THE BRAIN ===
    {
      id: "claude-opus-4-5",
      name: "Claude Opus 4.5",
      provider: "anthropic",
      connectionType: "api",
      strengths: ["coding", "reasoning", "architecture", "security", "testing", "creative", "documentation"],
      weaknesses: [],
      costTier: "premium",
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      supportsStreaming: true,
      supportsToolCalling: true,
      apiEndpoint: "https://api.anthropic.com",
      envKeys: ["ANTHROPIC_API_KEY"],
      enabled: true,
      priority: 1,
      modelId: "claude-opus-4-5-20251101",
    },

    // === CLAUDE SONNET 4 - FAST WORKHORSE ===
    {
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
      provider: "anthropic",
      connectionType: "api",
      strengths: ["coding", "reasoning", "testing"],
      weaknesses: [],
      costTier: "medium",
      contextWindow: 200_000,
      maxOutputTokens: 16_000,
      supportsStreaming: true,
      supportsToolCalling: true,
      apiEndpoint: "https://api.anthropic.com",
      envKeys: ["ANTHROPIC_API_KEY"],
      enabled: true,
      priority: 3,
      modelId: "claude-sonnet-4-20250514",
    },

    // === CHATGPT / CODEX ===
    {
      id: "chatgpt-codex",
      name: "ChatGPT Codex (GPT-5)",
      provider: "openai",
      connectionType: "api",
      strengths: ["coding", "documentation", "data_analysis", "creative"],
      weaknesses: ["security"],
      costTier: "high",
      contextWindow: 1_000_000,
      maxOutputTokens: 100_000,
      supportsStreaming: true,
      supportsToolCalling: true,
      apiEndpoint: "https://api.openai.com/v1",
      cliCommand: "codex",
      envKeys: ["OPENAI_API_KEY"],
      enabled: true,
      priority: 2,
      modelId: "gpt-5",
    },

    // === GEMINI PRO ULTRA ===
    {
      id: "gemini-pro-ultra",
      name: "Gemini 3 Pro",
      provider: "google",
      connectionType: "api",
      strengths: ["research", "multimodal", "web_browsing", "data_analysis", "coding"],
      weaknesses: [],
      costTier: "high",
      contextWindow: 2_000_000,
      maxOutputTokens: 65_536,
      supportsStreaming: true,
      supportsToolCalling: true,
      apiEndpoint: "https://generativelanguage.googleapis.com/v1beta",
      cliCommand: "gemini",
      browserUrl: "https://gemini.google.com",
      envKeys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
      enabled: true,
      priority: 2,
      modelId: "gemini-3-pro",
    },

    // === GROK ===
    {
      id: "grok",
      name: "Grok",
      provider: "xai",
      connectionType: "api",
      strengths: ["realtime_data", "creative", "reasoning"],
      weaknesses: ["coding", "security"],
      costTier: "medium",
      contextWindow: 131_072,
      maxOutputTokens: 32_000,
      supportsStreaming: true,
      supportsToolCalling: true,
      apiEndpoint: "https://api.x.ai/v1",
      browserUrl: "https://x.com/i/grok",
      envKeys: ["XAI_API_KEY"],
      enabled: true,
      priority: 4,
      modelId: "grok-3",
    },

    // === DEEPSEEK ===
    {
      id: "deepseek",
      name: "DeepSeek R1",
      provider: "deepseek",
      connectionType: "api",
      strengths: ["math", "reasoning", "coding", "optimization"],
      weaknesses: ["creative", "multimodal"],
      costTier: "low",
      contextWindow: 128_000,
      maxOutputTokens: 32_000,
      supportsStreaming: true,
      supportsToolCalling: true,
      apiEndpoint: "https://api.deepseek.com/v1",
      envKeys: ["DEEPSEEK_API_KEY"],
      enabled: true,
      priority: 3,
      modelId: "deepseek-r1",
    },

    // === QWEN ===
    {
      id: "qwen",
      name: "Qwen 3",
      provider: "qwen",
      connectionType: "api",
      strengths: ["i18n", "coding", "math", "reasoning"],
      weaknesses: ["creative", "realtime_data"],
      costTier: "low",
      contextWindow: 131_072,
      maxOutputTokens: 16_000,
      supportsStreaming: true,
      supportsToolCalling: true,
      apiEndpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      envKeys: ["QWEN_API_KEY", "DASHSCOPE_API_KEY"],
      enabled: true,
      priority: 4,
      modelId: "qwen3-235b-a22b",
    },

    // === LOCAL GPU (RTX 5090) ===
    {
      id: "local-gpu",
      name: "Local GPU (Ollama / GLM-4.7-Flash)",
      provider: "ollama",
      connectionType: "api",
      strengths: ["coding", "reasoning"],
      weaknesses: ["multimodal", "web_browsing", "realtime_data"],
      costTier: "free",
      contextWindow: 32_000,
      maxOutputTokens: 8_000,
      supportsStreaming: true,
      supportsToolCalling: true,
      apiEndpoint: "http://localhost:11434/v1",
      envKeys: [],
      enabled: true,
      priority: 5,
      modelId: "glm4.7-flash",
    },
  ]

  let members: FederationMember[] = [...FEDERATION_MEMBERS]

  /**
   * Get all registered federation members
   */
  export function list(): FederationMember[] {
    return members
  }

  /**
   * Get all enabled federation members
   */
  export function active(): FederationMember[] {
    return members.filter((m) => m.enabled)
  }

  /**
   * Get a specific member by ID
   */
  export function get(id: string): FederationMember | undefined {
    return members.find((m) => m.id === id)
  }

  /**
   * Register a new AI service in the federation
   */
  export function register(member: FederationMember): void {
    const existing = members.findIndex((m) => m.id === member.id)
    if (existing >= 0) {
      members[existing] = member
      log.info("updated federation member", { id: member.id })
    } else {
      members.push(member)
      log.info("registered federation member", { id: member.id, name: member.name })
    }
  }

  /**
   * Remove an AI service from the federation
   */
  export function unregister(id: string): void {
    members = members.filter((m) => m.id !== id)
    log.info("unregistered federation member", { id })
  }

  /**
   * Enable/disable a federation member
   */
  export function setEnabled(id: string, enabled: boolean): void {
    const member = members.find((m) => m.id === id)
    if (member) {
      member.enabled = enabled
      log.info("federation member status changed", { id, enabled })
    }
  }

  /**
   * Find members with a specific capability
   */
  export function findByCapability(capability: AICapability): FederationMember[] {
    return active()
      .filter((m) => m.strengths.includes(capability))
      .sort((a, b) => a.priority - b.priority)
  }

  /**
   * Find the best member for a set of required capabilities
   */
  export function findBest(requiredCapabilities: AICapability[]): FederationMember | undefined {
    const scored = active().map((member) => {
      let score = 0
      for (const cap of requiredCapabilities) {
        if (member.strengths.includes(cap)) score += 10
        if (member.weaknesses.includes(cap)) score -= 5
      }
      // Factor in priority (lower = better)
      score -= member.priority
      // Factor in cost (cheaper = better for tie-breaking)
      const costScore: Record<string, number> = { free: 5, low: 3, medium: 1, high: -1, premium: -2 }
      score += costScore[member.costTier] ?? 0
      return { member, score }
    })

    scored.sort((a, b) => b.score - a.score)
    return scored[0]?.member
  }

  /**
   * Get the cheapest member that has a required capability
   */
  export function findCheapest(capability: AICapability): FederationMember | undefined {
    const costOrder: Record<string, number> = { free: 0, low: 1, medium: 2, high: 3, premium: 4 }
    return findByCapability(capability).sort((a, b) => (costOrder[a.costTier] ?? 5) - (costOrder[b.costTier] ?? 5))[0]
  }

  /**
   * Get federation status summary
   */
  export function status(): {
    total: number
    active: number
    byConnectionType: Record<ConnectionType, number>
    byProvider: Record<string, number>
  } {
    const activeMembers = active()
    return {
      total: members.length,
      active: activeMembers.length,
      byConnectionType: {
        api: activeMembers.filter((m) => m.connectionType === "api").length,
        cli: activeMembers.filter((m) => m.connectionType === "cli").length,
        browser: activeMembers.filter((m) => m.connectionType === "browser").length,
      },
      byProvider: activeMembers.reduce(
        (acc, m) => {
          acc[m.provider] = (acc[m.provider] ?? 0) + 1
          return acc
        },
        {} as Record<string, number>,
      ),
    }
  }

  /**
   * Reset federation to defaults
   */
  export function reset(): void {
    members = [...FEDERATION_MEMBERS]
    log.info("federation reset to defaults")
  }
}
