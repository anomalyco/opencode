import type { Provider } from "./provider"

/**
 * Provider Configuration System
 *
 * This namespace provides a comprehensive configuration system for provider-specific
 * caching and prompt ordering optimizations. It supports three caching paradigms:
 *
 * 1. Explicit Breakpoint (Anthropic, Bedrock, Google Vertex Anthropic)
 *    - Uses explicit cache markers (cacheControl, cachePoint)
 *    - Has a hierarchy of what to cache and max breakpoints
 *
 * 2. Automatic Prefix (OpenAI, Azure, GitHub Copilot, DeepSeek)
 *    - Caching is automatic based on prefix matching
 *    - No explicit markers needed
 *
 * 3. Implicit/Content-based (Google/Gemini 2.5+)
 *    - Provider handles caching automatically
 *    - Based on content hashing
 *
 * Configuration hierarchy (highest priority last):
 *   Provider Defaults → User Provider Config → User Agent Config
 *
 * NOTE: Many settings here (minTokens, TTL, cache type, etc.) are hardcoded because
 * models.dev does not provide this caching metadata. These values are derived from:
 * - Provider documentation (Anthropic, OpenAI, Google, etc.)
 * - Empirical testing
 * - Community knowledge
 *
 * If models.dev adds caching metadata in the future, we should migrate to using it.
 */
export namespace ProviderConfig {
  // ============================================
  // TYPE DEFINITIONS
  // ============================================

  /**
   * Cache type determines how caching is applied
   */
  export type CacheType = "explicit-breakpoint" | "automatic-prefix" | "implicit" | "passthrough" | "none"

  /**
   * TTL values supported by providers
   */
  export type CacheTTL = "5m" | "1h" | "auto"

  /**
   * Prompt section identifiers for ordering
   */
  export type PromptSection = "tools" | "instructions" | "environment" | "system" | "messages"

  /**
   * Model family patterns for minTokens resolution
   */
  export interface MinTokensByModel {
    [pattern: string]: number
    default: number
  }

  /**
   * Cache configuration for a provider
   */
  export interface CacheConfig {
    /** Whether caching is enabled */
    enabled: boolean
    /** Type of caching mechanism */
    type: CacheType
    /** Property name used for cache control (e.g., 'cacheControl', 'cachePoint', 'cache_control') */
    property: string | null
    /** Order of sections to apply cache breakpoints */
    hierarchy: PromptSection[]
    /** Time-to-live for cached content */
    ttl: CacheTTL
    /** Minimum tokens required for caching (can be number or model-specific map) */
    minTokens: number | MinTokensByModel
    /** Maximum number of cache breakpoints allowed */
    maxBreakpoints: number
  }

  /**
   * How system prompts should be passed to the provider
   * - "role": Use system role in messages array (OpenAI, Mistral)
   * - "parameter": Use top-level system parameter (Anthropic, Bedrock)
   * - "systemInstruction": Use systemInstruction field (Google/Gemini)
   *
   * Note: The AI SDK handles most of this automatically, but we use this
   * to inform our caching and ordering strategies.
   */
  export type SystemPromptMode = "role" | "parameter" | "systemInstruction"

  /**
   * Prompt ordering configuration for a provider
   */
  export interface PromptOrderConfig {
    /** Order of prompt sections for optimal caching */
    ordering: PromptSection[]
    /** Sections that should have cache breakpoints applied */
    cacheBreakpoints: PromptSection[]
    /** Whether to combine all system content into a single message (most providers require this) */
    combineSystemMessages: boolean
    /** How system prompts are passed to the provider */
    systemPromptMode: SystemPromptMode
    /** Whether tools can be cached (explicit breakpoint providers only) */
    toolCaching: boolean
    /** Whether provider requires alternating user/assistant messages */
    requiresAlternatingRoles: boolean
    /** Whether to sort tools alphabetically for consistent prefix matching */
    sortTools: boolean
  }

  /**
   * Complete provider configuration
   */
  export interface Config {
    cache: CacheConfig
    promptOrder: PromptOrderConfig
  }

  /**
   * User-configurable overrides (partial)
   */
  export interface UserCacheConfig {
    enabled?: boolean
    ttl?: CacheTTL
    minTokens?: number
    maxBreakpoints?: number
  }

  export interface UserPromptOrderConfig {
    ordering?: PromptSection[]
    cacheBreakpoints?: PromptSection[]
  }

  export interface UserConfig {
    cache?: UserCacheConfig
    promptOrder?: UserPromptOrderConfig
  }

  // ============================================
  // PROVIDER DEFAULTS
  // ============================================

  /**
   * Default configurations for all supported providers
   *
   * IMPORTANT: These values are hardcoded because models.dev does not provide:
   * - minTokens: Minimum tokens required for caching (varies by model)
   * - ttl: Cache time-to-live (provider-specific)
   * - cacheType: How caching works (explicit markers vs automatic)
   * - maxBreakpoints: Maximum cache breakpoints allowed
   *
   * Sources for these values:
   * - Anthropic: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
   * - OpenAI: https://platform.openai.com/docs/guides/prompt-caching
   * - Google: https://ai.google.dev/gemini-api/docs/caching
   * - AWS Bedrock: https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
   */
  export const defaults: Record<string, Config> = {
    // ----------------------------------------
    // EXPLICIT BREAKPOINT PROVIDERS
    // These providers require explicit cache_control markers on messages
    // ----------------------------------------

    anthropic: {
      cache: {
        enabled: true,
        type: "explicit-breakpoint",
        property: "cacheControl",
        hierarchy: ["tools", "system", "messages"],
        ttl: "5m", // Anthropic cache TTL is 5 minutes (not configurable via API)
        // minTokens values from Anthropic docs - minimum cacheable content size
        // https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching#requirements
        minTokens: {
          // Claude 4.x family - higher minimum for larger models
          "claude-opus-4": 4096,
          "claude-opus-4-5": 4096,
          "claude-opus-4.5": 4096,
          "claude-sonnet-4": 2048,
          "claude-sonnet-4-5": 2048,
          "claude-sonnet-4.5": 2048,
          "claude-haiku-4": 2048,
          "claude-haiku-4-5": 2048,
          "claude-haiku-4.5": 2048,
          // Claude 3.x family
          "claude-3-opus": 2048,
          "claude-3-5-opus": 2048,
          "claude-3-sonnet": 1024,
          "claude-3-5-sonnet": 2048,
          "claude-3-haiku": 1024,
          "claude-3-5-haiku": 2048,
          default: 1024,
        },
        maxBreakpoints: 4,
      },
      promptOrder: {
        ordering: ["tools", "instructions", "environment", "system", "messages"],
        cacheBreakpoints: ["tools", "system", "messages"],
        combineSystemMessages: false, // Anthropic supports multiple system messages
        systemPromptMode: "parameter",
        toolCaching: true,
        requiresAlternatingRoles: true,
        sortTools: true,
      },
    },

    "amazon-bedrock": {
      cache: {
        enabled: true,
        type: "explicit-breakpoint",
        property: "cachePoint", // Bedrock uses "cachePoint" instead of "cacheControl"
        // Bedrock has different hierarchy than direct Anthropic
        hierarchy: ["system", "messages", "tools"],
        ttl: "5m", // Bedrock cache TTL matches Anthropic (5 minutes)
        // minTokens for Bedrock models - Nova has lower minimums than Claude
        // https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
        minTokens: {
          // Amazon Nova models - 1000 token minimum
          "nova-micro": 1000,
          "nova-lite": 1000,
          "nova-pro": 1000,
          "nova-premier": 1000,
          // Claude 4.x family
          "claude-opus-4": 4096,
          "claude-opus-4-5": 4096,
          "claude-opus-4.5": 4096,
          "claude-sonnet-4": 2048,
          "claude-sonnet-4-5": 2048,
          "claude-sonnet-4.5": 2048,
          "claude-haiku-4": 2048,
          "claude-haiku-4-5": 2048,
          "claude-haiku-4.5": 2048,
          // Claude 3.x family
          "claude-3-opus": 2048,
          "claude-3-5-opus": 2048,
          "claude-3-sonnet": 1024,
          "claude-3-5-sonnet": 2048,
          "claude-3-haiku": 1024,
          "claude-3-5-haiku": 2048,
          default: 1024,
        },
        maxBreakpoints: 4,
      },
      promptOrder: {
        // Bedrock: system first, tools at end
        ordering: ["system", "instructions", "environment", "messages", "tools"],
        cacheBreakpoints: ["system", "messages", "tools"],
        combineSystemMessages: false, // Bedrock supports multiple system messages for Claude
        systemPromptMode: "parameter",
        toolCaching: true,
        requiresAlternatingRoles: true,
        sortTools: true,
      },
    },

    "google-vertex-anthropic": {
      cache: {
        enabled: true,
        type: "explicit-breakpoint",
        property: "cacheControl",
        hierarchy: ["tools", "system", "messages"],
        ttl: "5m",
        minTokens: {
          // Claude 4.x family
          "claude-opus-4": 4096,
          "claude-opus-4-5": 4096,
          "claude-opus-4.5": 4096,
          "claude-sonnet-4": 2048,
          "claude-sonnet-4-5": 2048,
          "claude-sonnet-4.5": 2048,
          "claude-haiku-4": 2048,
          "claude-haiku-4-5": 2048,
          "claude-haiku-4.5": 2048,
          // Claude 3.x family
          "claude-3-opus": 2048,
          "claude-3-5-opus": 2048,
          "claude-3-sonnet": 1024,
          "claude-3-5-sonnet": 2048,
          "claude-3-haiku": 1024,
          "claude-3-5-haiku": 2048,
          default: 1024,
        },
        maxBreakpoints: 4,
      },
      promptOrder: {
        ordering: ["tools", "instructions", "environment", "system", "messages"],
        cacheBreakpoints: ["tools", "system", "messages"],
        combineSystemMessages: false, // Supports multiple system messages
        systemPromptMode: "parameter",
        toolCaching: true,
        requiresAlternatingRoles: true,
        sortTools: true,
      },
    },

    // ----------------------------------------
    // AUTOMATIC PREFIX PROVIDERS
    // These providers automatically cache based on prefix matching.
    // No explicit markers needed - just ensure consistent ordering.
    // ----------------------------------------

    openai: {
      cache: {
        enabled: true,
        type: "automatic-prefix",
        property: null, // No explicit cache markers needed
        hierarchy: [],
        ttl: "auto", // OpenAI manages TTL automatically (5-60 min based on usage)
        minTokens: 1024, // OpenAI requires 1024 token minimum for caching
        maxBreakpoints: 0, // Not applicable for prefix caching
      },
      promptOrder: {
        // Static content first for prefix caching
        ordering: ["instructions", "tools", "environment", "system", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // OpenAI prefers single system message
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false, // OpenAI allows consecutive same-role
        sortTools: true, // Sort for prefix consistency
      },
    },

    azure: {
      cache: {
        enabled: true,
        type: "automatic-prefix",
        property: null,
        hierarchy: [],
        ttl: "auto",
        minTokens: 1024,
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["instructions", "tools", "environment", "system", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // Azure OpenAI prefers single system message
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false,
        sortTools: true,
      },
    },

    "azure-cognitive-services": {
      cache: {
        enabled: true,
        type: "automatic-prefix",
        property: null,
        hierarchy: [],
        ttl: "auto",
        minTokens: 1024,
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["instructions", "tools", "environment", "system", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // Prefers single system message
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false,
        sortTools: true,
      },
    },

    "github-copilot": {
      cache: {
        enabled: true,
        type: "automatic-prefix",
        property: null,
        hierarchy: [],
        ttl: "auto",
        minTokens: 1024,
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["instructions", "tools", "environment", "system", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // OpenAI-compatible, prefers single system message
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false,
        sortTools: true,
      },
    },

    "github-copilot-enterprise": {
      cache: {
        enabled: true,
        type: "automatic-prefix",
        property: null,
        hierarchy: [],
        ttl: "auto",
        minTokens: 1024,
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["instructions", "tools", "environment", "system", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // OpenAI-compatible, prefers single system message
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false,
        sortTools: true,
      },
    },

    opencode: {
      cache: {
        enabled: true,
        type: "automatic-prefix",
        property: null,
        hierarchy: [],
        ttl: "auto",
        minTokens: 1024,
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["instructions", "tools", "environment", "system", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // Prefers single system message
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false,
        sortTools: true,
      },
    },

    deepseek: {
      cache: {
        enabled: true,
        type: "automatic-prefix",
        property: null,
        hierarchy: [],
        ttl: "auto",
        minTokens: 0, // DeepSeek has no minimum
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["instructions", "tools", "environment", "system", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // DeepSeek prefers single system message
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false,
        sortTools: true,
      },
    },

    // ----------------------------------------
    // IMPLICIT CACHING PROVIDERS
    // These providers handle caching automatically based on content hashing.
    // No special ordering or markers needed.
    // ----------------------------------------

    google: {
      cache: {
        enabled: true,
        type: "implicit", // Gemini 2.5+ uses implicit context caching
        property: null,
        hierarchy: [],
        ttl: "auto", // Google manages TTL (1 hour default, configurable via API)
        // Gemini minTokens - content must exceed this for caching
        // https://ai.google.dev/gemini-api/docs/caching
        minTokens: {
          "gemini-2.5-pro": 4096,
          "gemini-2.5-flash": 2048,
          "gemini-2.0-flash": 2048,
          "gemini-2.0-pro": 4096,
          "gemini-3": 2048,
          default: 2048,
        },
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["system", "instructions", "environment", "tools", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // Gemini uses systemInstruction, prefers single
        systemPromptMode: "systemInstruction",
        toolCaching: false,
        requiresAlternatingRoles: true, // Gemini requires alternating user/model
        sortTools: false,
      },
    },

    "google-vertex": {
      cache: {
        enabled: true,
        type: "implicit", // Same as google - uses implicit context caching
        property: null,
        hierarchy: [],
        ttl: "auto",
        // Same minTokens as google
        minTokens: {
          "gemini-2.5-pro": 4096,
          "gemini-2.5-flash": 2048,
          "gemini-2.0-flash": 2048,
          "gemini-2.0-pro": 4096,
          "gemini-3": 2048,
          default: 2048,
        },
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["system", "instructions", "environment", "tools", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // Gemini uses systemInstruction, prefers single
        systemPromptMode: "systemInstruction",
        toolCaching: false,
        requiresAlternatingRoles: true, // Gemini requires alternating user/model
        sortTools: false,
      },
    },

    // ----------------------------------------
    // PASSTHROUGH PROVIDERS
    // ----------------------------------------

    openrouter: {
      cache: {
        enabled: true,
        type: "passthrough",
        property: "cache_control",
        // Use Anthropic-style for passthrough since most users use Claude via OpenRouter
        hierarchy: ["tools", "system", "messages"],
        ttl: "5m",
        minTokens: 1024,
        maxBreakpoints: 4,
      },
      promptOrder: {
        // Optimized for Anthropic models (most common on OpenRouter)
        ordering: ["tools", "instructions", "environment", "system", "messages"],
        cacheBreakpoints: ["tools", "system"],
        combineSystemMessages: false, // Depends on underlying model, allow multiple
        systemPromptMode: "parameter", // For Claude models
        toolCaching: true,
        requiresAlternatingRoles: true, // Most models on OpenRouter require this
        sortTools: true,
      },
    },

    vercel: {
      cache: {
        enabled: true,
        type: "passthrough",
        property: null,
        hierarchy: [],
        ttl: "auto",
        minTokens: 1024,
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["system", "instructions", "environment", "tools", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // Default to single for safety
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false,
        sortTools: true,
      },
    },

    zenmux: {
      cache: {
        enabled: true,
        type: "passthrough",
        property: null,
        hierarchy: [],
        ttl: "auto",
        minTokens: 1024,
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["system", "instructions", "environment", "tools", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // Default to single for safety
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false,
        sortTools: true,
      },
    },

    // ----------------------------------------
    // NO CACHING PROVIDERS
    // These providers do not support prompt caching (as of this writing).
    // Check provider docs periodically as caching support may be added.
    // ----------------------------------------

    mistral: {
      cache: {
        enabled: false,
        type: "none",
        property: null,
        hierarchy: [],
        ttl: "auto",
        minTokens: 0,
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["system", "instructions", "environment", "tools", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // Mistral prefers single system message
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false,
        sortTools: false,
      },
    },

    qwen: {
      cache: {
        enabled: false,
        type: "none",
        property: null,
        hierarchy: [],
        ttl: "auto",
        minTokens: 0,
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["system", "instructions", "environment", "tools", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // Qwen prefers single system message
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false,
        sortTools: false,
      },
    },

    cerebras: {
      cache: {
        enabled: false,
        type: "none",
        property: null,
        hierarchy: [],
        ttl: "auto",
        minTokens: 0,
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["system", "instructions", "environment", "tools", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // Default to single for safety
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false,
        sortTools: false,
      },
    },

    "sap-ai-core": {
      cache: {
        enabled: false,
        type: "none",
        property: null,
        hierarchy: [],
        ttl: "auto",
        minTokens: 0,
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["system", "instructions", "environment", "tools", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // Default to single for safety
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false,
        sortTools: false,
      },
    },

    baseten: {
      cache: {
        enabled: false,
        type: "none",
        property: null,
        hierarchy: [],
        ttl: "auto",
        minTokens: 0,
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["system", "instructions", "environment", "tools", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // Default to single for safety
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false,
        sortTools: false,
      },
    },

    // ----------------------------------------
    // DEFAULT FALLBACK
    // ----------------------------------------

    default: {
      cache: {
        enabled: false,
        type: "none",
        property: null,
        hierarchy: [],
        ttl: "auto",
        minTokens: 0,
        maxBreakpoints: 0,
      },
      promptOrder: {
        ordering: ["system", "instructions", "environment", "tools", "messages"],
        cacheBreakpoints: [],
        combineSystemMessages: true, // Default to single for maximum compatibility
        systemPromptMode: "role",
        toolCaching: false,
        requiresAlternatingRoles: false,
        sortTools: false,
      },
    },
  }

  // ============================================
  // CONFIG RESOLUTION
  // ============================================

  /**
   * Resolve minTokens for a specific model
   */
  export function resolveMinTokens(minTokens: number | MinTokensByModel, model?: Provider.Model): number {
    if (typeof minTokens === "number") return minTokens
    if (!model) return minTokens.default

    const modelID = model.id.toLowerCase()
    const family = model.family?.toLowerCase()

    // Check for pattern matches
    for (const [pattern, tokens] of Object.entries(minTokens)) {
      if (pattern === "default") continue
      if (modelID.includes(pattern) || (family && family.includes(pattern))) {
        return tokens
      }
    }

    return minTokens.default
  }

  /**
   * Detect effective provider for passthrough providers like OpenRouter
   */
  export function detectEffectiveProvider(model: Provider.Model): string {
    if (model.providerID !== "openrouter") return model.providerID

    const apiID = model.api.id.toLowerCase()

    // Detect underlying provider from model ID
    if (apiID.includes("anthropic/") || apiID.includes("claude")) return "anthropic"
    if (apiID.includes("openai/") || apiID.includes("gpt")) return "openai"
    if (apiID.includes("google/") || apiID.includes("gemini")) return "google"
    if (apiID.includes("deepseek/")) return "deepseek"
    if (apiID.includes("mistral/")) return "mistral"

    return model.providerID
  }

  /**
   * Merge user config with defaults
   */
  function mergeConfig(base: Config, user?: UserConfig): Config {
    if (!user) return base

    return {
      cache: {
        ...base.cache,
        ...(user.cache?.enabled !== undefined && { enabled: user.cache.enabled }),
        ...(user.cache?.ttl !== undefined && { ttl: user.cache.ttl }),
        ...(user.cache?.minTokens !== undefined && { minTokens: user.cache.minTokens }),
        ...(user.cache?.maxBreakpoints !== undefined && { maxBreakpoints: user.cache.maxBreakpoints }),
      },
      promptOrder: {
        ...base.promptOrder,
        ...(user.promptOrder?.ordering && { ordering: user.promptOrder.ordering }),
        ...(user.promptOrder?.cacheBreakpoints && { cacheBreakpoints: user.promptOrder.cacheBreakpoints }),
      },
    }
  }

  /**
   * Get configuration for a provider with optional model and agent overrides
   *
   * @param providerID - The provider identifier
   * @param model - Optional model for minTokens resolution
   * @param agentID - Optional agent identifier for agent-specific overrides
   * @param userProviderConfig - Optional user provider configuration
   * @param userAgentConfig - Optional user agent configuration
   */
  export function getConfig(
    providerID: string,
    model?: Provider.Model,
    agentID?: string,
    userProviderConfig?: UserConfig,
    userAgentConfig?: UserConfig,
  ): Config {
    // Get provider defaults
    const providerDefaults = defaults[providerID] ?? defaults.default

    // Apply user provider config
    let config = mergeConfig(providerDefaults, userProviderConfig)

    // Apply user agent config (highest priority)
    if (agentID && userAgentConfig) {
      config = mergeConfig(config, userAgentConfig)
    }

    // Resolve minTokens for the specific model
    if (model && typeof config.cache.minTokens !== "number") {
      config = {
        ...config,
        cache: {
          ...config.cache,
          minTokens: resolveMinTokens(config.cache.minTokens, model),
        },
      }
    }

    return config
  }

  /**
   * Get the prompt ordering for a provider
   * @param model - The model to get ordering for
   * @param agentID - Optional agent ID for agent-specific overrides
   * @param userConfig - User config that can override prompt ordering
   */
  export function getPromptOrdering(model: Provider.Model, agentID?: string, userConfig?: UserConfig): PromptSection[] {
    // When userConfig is provided without agentID, use it as provider config
    // When both are provided, use userConfig as agent config
    const providerConfig = agentID ? undefined : userConfig
    const agentConfig = agentID ? userConfig : undefined
    const config = getConfig(model.providerID, model, agentID, providerConfig, agentConfig)
    return config.promptOrder.ordering
  }

  /**
   * Check if a provider supports explicit cache breakpoints
   */
  export function supportsExplicitCaching(providerID: string): boolean {
    const config = defaults[providerID] ?? defaults.default
    return config.cache.type === "explicit-breakpoint" || config.cache.type === "passthrough"
  }

  /**
   * Get the cache control property name for a provider
   */
  export function getCacheProperty(providerID: string): string | null {
    const config = defaults[providerID] ?? defaults.default
    return config.cache.property
  }

  /**
   * Check if caching is enabled for a provider
   */
  export function isCachingEnabled(providerID: string, model?: Provider.Model, userConfig?: UserConfig): boolean {
    const config = getConfig(providerID, model, undefined, userConfig)
    return config.cache.enabled
  }

  /**
   * Get provider options key for cache control based on npm package
   */
  export function getProviderOptionsKey(npm: string, providerID: string): string {
    switch (npm) {
      case "@ai-sdk/anthropic":
        return "anthropic"
      case "@ai-sdk/amazon-bedrock":
        return "bedrock"
      case "@openrouter/ai-sdk-provider":
        return "openrouter"
      case "@ai-sdk/openai-compatible":
        return "openaiCompatible"
      default:
        return providerID
    }
  }

  /**
   * Build cache control object for a specific provider
   */
  export function buildCacheControl(providerID: string, ttl: CacheTTL = "5m"): Record<string, any> {
    const config = defaults[providerID] ?? defaults.default

    if (!config.cache.property) return {}

    // Build the cache control value based on provider
    switch (config.cache.type) {
      case "explicit-breakpoint":
        // Anthropic/Bedrock style
        if (ttl === "1h") {
          // Extended cache (if supported)
          return { type: "ephemeral" } // Currently only ephemeral is widely supported
        }
        return { type: "ephemeral" }

      case "passthrough":
        // OpenRouter style
        return { type: "ephemeral" }

      default:
        return {}
    }
  }

  /**
   * Convert user config from Config module format to ProviderConfig.UserConfig format
   *
   * This bridges the gap between the user-facing config schema (in config/config.ts)
   * and the internal ProviderConfig format. Works for both provider and agent configs.
   *
   * @param providerConfig - Config from Config.get().provider[providerID] or Config.get().agent[agentID]
   */
  export function fromUserProviderConfig(providerConfig?: {
    cache?: {
      enabled?: boolean
      ttl?: CacheTTL
      minTokens?: number
      maxBreakpoints?: number
    }
    promptOrder?: {
      ordering?: PromptSection[]
      cacheBreakpoints?: PromptSection[]
    }
  }): UserConfig | undefined {
    if (!providerConfig) return undefined
    if (!providerConfig.cache && !providerConfig.promptOrder) return undefined

    const result: UserConfig = {}

    if (providerConfig.cache) {
      result.cache = {}
      if (providerConfig.cache.enabled !== undefined) result.cache.enabled = providerConfig.cache.enabled
      if (providerConfig.cache.ttl !== undefined) result.cache.ttl = providerConfig.cache.ttl
      if (providerConfig.cache.minTokens !== undefined) result.cache.minTokens = providerConfig.cache.minTokens
      if (providerConfig.cache.maxBreakpoints !== undefined)
        result.cache.maxBreakpoints = providerConfig.cache.maxBreakpoints
    }

    if (providerConfig.promptOrder) {
      result.promptOrder = {}
      if (providerConfig.promptOrder.ordering) result.promptOrder.ordering = providerConfig.promptOrder.ordering
      if (providerConfig.promptOrder.cacheBreakpoints)
        result.promptOrder.cacheBreakpoints = providerConfig.promptOrder.cacheBreakpoints
    }

    return result
  }
}
