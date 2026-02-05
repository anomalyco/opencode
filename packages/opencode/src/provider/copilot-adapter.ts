/**
 * Dedicated adapter for GitHub Copilot provider.
 * Centralizes the Copilot-specific logic that was scattered across provider.ts and plugin/copilot.ts.
 */
import { Log } from "../util/log"

const log = Log.create({ service: "provider:copilot" })

export namespace CopilotAdapter {
  export interface CopilotAuth {
    token: string
    baseUrl: string
    models: string[]
  }

  /** Default Copilot models */
  export const DEFAULT_MODELS = [
    "gpt-4o",
    "gpt-4o-mini",
    "claude-3.5-sonnet",
    "claude-sonnet-4-20250514",
    "o3-mini",
    "o4-mini",
    "gemini-2.0-flash",
  ] as const

  /** Map Copilot model IDs to their AI SDK npm packages */
  export function getModelPackage(modelId: string): string {
    if (modelId.startsWith("claude")) return "@ai-sdk/anthropic"
    if (modelId.startsWith("gemini")) return "@ai-sdk/google"
    if (modelId.startsWith("o1") || modelId.startsWith("o3") || modelId.startsWith("o4")) return "@ai-sdk/openai"
    return "@ai-sdk/github-copilot"
  }

  /** Check if model needs Claude-specific API URL */
  export function needsClaudeUrl(modelId: string): boolean {
    return modelId.startsWith("claude")
  }

  /** Get the appropriate API URL for a Copilot model */
  export function getApiUrl(baseUrl: string, modelId: string): string {
    if (needsClaudeUrl(modelId)) {
      return `${baseUrl}/v1`
    }
    return baseUrl
  }

  /** Copilot pricing (all free with subscription) */
  export const COST = {
    input: 0,
    output: 0,
    cache: { read: 0, write: 0 },
  } as const
}
