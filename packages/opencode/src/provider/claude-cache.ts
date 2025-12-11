import type { Provider } from "./provider"
import { Flag } from "../flag/flag"
import { Log } from "../util/log"

/**
 * Claude model prompt caching configuration and utilities.
 *
 * This module handles caching for Claude models, including when accessed through:
 * - Anthropic (native API)
 * - AWS Bedrock
 * - OpenRouter
 *
 * Other providers (OpenAI, Google) have different caching mechanisms not covered here.
 *
 * Cache support is determined by whether a model has cache cost data from models.dev.
 *
 * Anthropic's cache hierarchy: tools → system → messages
 * Cache reads typically cost ~10% of base input (90% savings)
 * Cache writes cost 1.25x (5m TTL) or 2x (1h TTL)
 *
 * Set OPENCODE_DISABLE_CACHE=true to disable all caching (for debugging)
 *
 * @see https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 */
export namespace ClaudeCache {
  const log = Log.create({ service: "claude-cache" })

  export type CacheTtl = "5m" | "1h"

  export interface CacheConfig {
    enabled?: boolean
    toolsTtl?: CacheTtl
    instructionsTtl?: CacheTtl
  }

  /**
   * Default cache configuration - safe defaults with no negative impact
   */
  export const defaults: Required<CacheConfig> = {
    enabled: true,
    toolsTtl: "5m",
    instructionsTtl: "5m",
  }

  /**
   * Minimum cacheable tokens by model family.
   * Content below this threshold won't be cached by Anthropic.
   *
   * Source: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching#cache-limitations
   *
   * Note: This data is not available programmatically from any API (models.dev, Anthropic API, etc.)
   * so we maintain this lookup table manually based on Anthropic's documentation.
   */
  const minCacheableTokensByFamily: Record<string, number> = {
    // 4096 tokens minimum
    "opus-4.5": 4096,
    "opus-4-5": 4096,
    "haiku-4.5": 4096,
    "haiku-4-5": 4096,
    "sonnet-4.5": 4096,
    "sonnet-4-5": 4096,

    // 2048 tokens minimum
    "haiku-3": 2048,
    "haiku-3.5": 2048,
    "haiku-3-5": 2048,

    // 1024 tokens minimum (most models)
    "opus-4": 1024,
    "opus-4.0": 1024,
    "opus-4.1": 1024,
    "opus-4-0": 1024,
    "opus-4-1": 1024,
    "opus-3": 1024,
    "sonnet-4": 1024,
    "sonnet-4.0": 1024,
    "sonnet-4-0": 1024,
    "sonnet-3.5": 1024,
    "sonnet-3-5": 1024,
    "sonnet-3.7": 1024,
    "sonnet-3-7": 1024,
  }

  /** Default minimum tokens if model family not found */
  const DEFAULT_MIN_TOKENS = 1024

  /**
   * Extract the model family from a model ID.
   *
   * Handles various ID formats:
   * - Anthropic API: claude-sonnet-4-5-20250929, claude-3-5-haiku-20241022
   * - Bedrock: anthropic.claude-sonnet-4-5-20250929-v1:0
   * - Vertex: claude-sonnet-4-5@20250929
   * - Aliases: claude-sonnet-4-5, claude-opus-4.5
   * - OpenRouter: anthropic/claude-sonnet-4-5
   *
   * @returns Normalized family string like "sonnet-4-5", "haiku-3", "opus-4.1"
   */
  function extractFamily(modelId: string): string | undefined {
    const id = modelId.toLowerCase()

    // Try to match known patterns and extract family
    // Pattern: (opus|sonnet|haiku)-X-Y or (opus|sonnet|haiku)-X.Y or X-Y-(opus|sonnet|haiku)
    const patterns = [
      // claude-opus-4-5, claude-sonnet-4.5, claude-haiku-4-5
      /claude[.-]?(opus|sonnet|haiku)[.-]?(\d+)[.-](\d+)/,
      // claude-opus-4, claude-sonnet-4, claude-haiku-4
      /claude[.-]?(opus|sonnet|haiku)[.-]?(\d+)(?![.-]\d)/,
      // claude-3-5-haiku, claude-3-haiku (legacy naming)
      /claude[.-]?(\d+)[.-]?(\d+)?[.-]?(opus|sonnet|haiku)/,
    ]

    for (const pattern of patterns) {
      const match = id.match(pattern)
      if (match) {
        // Extract model type and version numbers
        const groups = match.slice(1).filter(Boolean)

        // Determine if it's legacy format (version before model type) or new format
        if (groups[0] && /^\d+$/.test(groups[0])) {
          // Legacy: claude-3-5-haiku → haiku-3-5 or claude-3-haiku → haiku-3
          const modelType = groups.find((g) => /^(opus|sonnet|haiku)$/.test(g))
          const versions = groups.filter((g) => /^\d+$/.test(g))
          if (modelType && versions.length > 0) {
            return versions.length > 1 ? `${modelType}-${versions.join("-")}` : `${modelType}-${versions[0]}`
          }
        } else {
          // New format: claude-opus-4-5 → opus-4-5
          const modelType = groups[0]
          const versions = groups.slice(1).filter((g) => /^\d+$/.test(g))
          if (modelType && versions.length > 0) {
            return `${modelType}-${versions.join("-")}`
          }
        }
      }
    }

    return undefined
  }

  /**
   * Check if a model supports Anthropic-style prompt caching.
   * Uses the model's cache cost data from models.dev as the source of truth.
   */
  export function isSupported(model: Provider.Model): boolean {
    // If model has cache cost data, it supports caching
    if (model.cost.cache.read > 0 || model.cost.cache.write > 0) {
      return true
    }
    // Fallback: check if it's a known caching-capable provider/model
    // This handles cases where models.dev data might not have cache costs yet
    return (
      model.providerID === "anthropic" ||
      model.providerID === "bedrock" ||
      model.api.id.includes("anthropic") ||
      model.api.id.includes("claude")
    )
  }

  /**
   * Get the cache control format for a specific provider.
   * Different providers use different field names for cache control.
   *
   * @param providerID - The provider ID
   * @param ttl - Cache TTL (note: Bedrock doesn't support TTL)
   */
  export function getProviderCacheControl(providerID: string, ttl: CacheTtl = "5m") {
    // Bedrock uses different field name and doesn't support TTL
    if (providerID === "bedrock") {
      return {
        bedrock: {
          cachePoint: { type: "ephemeral" },
        },
      }
    }

    // Anthropic native API
    if (providerID === "anthropic") {
      return {
        anthropic: {
          cacheControl: { type: "ephemeral", ttl },
        },
      }
    }

    // OpenRouter and other OpenAI-compatible providers
    // These typically follow the Anthropic format but with snake_case
    return {
      openrouter: {
        cache_control: { type: "ephemeral", ttl },
      },
      openaiCompatible: {
        cache_control: { type: "ephemeral", ttl },
      },
    }
  }

  /**
   * Get all provider cache control options (for applying to multiple providers at once).
   * Used when we don't know exactly which provider format will be used.
   */
  export function getAllProviderCacheControls(providerID: string, ttl: CacheTtl = "5m") {
    // Bedrock doesn't support TTL
    if (providerID === "bedrock") {
      return {
        anthropic: {
          cacheControl: { type: "ephemeral" },
        },
        bedrock: {
          cachePoint: { type: "ephemeral" },
        },
      }
    }

    const cacheControl = { type: "ephemeral" as const, ttl }
    return {
      anthropic: {
        cacheControl,
      },
      openrouter: {
        cache_control: cacheControl,
      },
      openaiCompatible: {
        cache_control: cacheControl,
      },
    }
  }

  /**
   * Default provider options (no TTL specified, uses 5m default)
   * Used for message caching where TTL config isn't applied.
   */
  export const providerOptions = {
    anthropic: {
      cacheControl: { type: "ephemeral" },
    },
    openrouter: {
      cache_control: { type: "ephemeral" },
    },
    bedrock: {
      cachePoint: { type: "ephemeral" },
    },
    openaiCompatible: {
      cache_control: { type: "ephemeral" },
    },
  } as const

  /**
   * Get minimum cacheable tokens for a model.
   *
   * Uses a lookup table based on Anthropic's documented requirements.
   * This data is not available programmatically from any API.
   *
   * @see https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching#cache-limitations
   */
  export function getMinCacheableTokens(model: Provider.Model): number {
    // First try model.family if available (most reliable)
    if (model.family) {
      const familyLower = model.family.toLowerCase()
      // Direct lookup: check if family contains a known key
      for (const [key, tokens] of Object.entries(minCacheableTokensByFamily)) {
        if (familyLower.includes(key)) {
          return tokens
        }
      }
      // Special case: if family is just "claude-haiku" or "haiku" without version, default to haiku-3 (2048)
      // This is because unversioned haiku refers to the 3.x series
      if (familyLower.includes("haiku") && !familyLower.match(/\d/)) {
        return 2048
      }
    }

    // Extract family from model ID
    const family = extractFamily(model.id)
    if (family) {
      // Direct lookup
      if (family in minCacheableTokensByFamily) {
        return minCacheableTokensByFamily[family]
      }
      // Try with dot separator instead of dash
      const dotFamily = family.replace(/-/g, ".")
      if (dotFamily in minCacheableTokensByFamily) {
        return minCacheableTokensByFamily[dotFamily]
      }
    }

    return DEFAULT_MIN_TOKENS
  }

  /**
   * Resolve cache configuration with priority: agent > provider > defaults
   */
  export function resolveConfig(providerConfig?: CacheConfig, agentConfig?: CacheConfig): Required<CacheConfig> {
    return {
      enabled: agentConfig?.enabled ?? providerConfig?.enabled ?? defaults.enabled,
      toolsTtl: agentConfig?.toolsTtl ?? providerConfig?.toolsTtl ?? defaults.toolsTtl,
      instructionsTtl: agentConfig?.instructionsTtl ?? providerConfig?.instructionsTtl ?? defaults.instructionsTtl,
    }
  }

  /**
   * Apply cache control to the last tool in a tools record.
   * Per Anthropic docs, tools are cached first in the hierarchy: tools → system → messages
   */
  export function applyToTools<T extends { providerOptions?: Record<string, unknown> }>(
    tools: Record<string, T>,
    model: Provider.Model,
    config?: CacheConfig,
  ): Record<string, T> {
    // Check environment variables first (for debugging/A/B testing)
    if (Flag.OPENCODE_DISABLE_CACHE || Flag.OPENCODE_LEGACY_CACHE) {
      return tools
    }

    // Check if model supports caching
    if (!isSupported(model)) {
      log.debug("tool caching skipped - model does not support caching", { model: model.id })
      return tools
    }

    const resolved = resolveConfig(undefined, config)
    if (!resolved.enabled) {
      log.debug("tool caching disabled via config")
      return tools
    }

    const keys = Object.keys(tools)
    if (keys.length === 0) {
      log.debug("tool caching skipped - no tools")
      return tools
    }

    // Apply cache control to the last tool (creates breakpoint after all tools)
    const last = keys[keys.length - 1]
    const tool = tools[last]
    const cacheOptions = getAllProviderCacheControls(model.providerID, resolved.toolsTtl)

    return {
      ...tools,
      [last]: {
        ...tool,
        providerOptions: {
          ...tool.providerOptions,
          ...cacheOptions,
        },
      },
    }
  }
}
