import { describe, expect, test } from "bun:test"
import { ProviderConfig } from "../../src/provider/config"
import type { Provider } from "../../src/provider/provider"

// Helper to create mock models for testing
function createMockModel(providerID: string, modelID: string, family?: string): Provider.Model {
  return {
    id: modelID,
    providerID,
    family,
    api: {
      id: modelID,
      url: `https://api.${providerID}.com`,
      npm: `@ai-sdk/${providerID}`,
    },
    name: modelID,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    },
    limit: {
      context: 100000,
      output: 4096,
    },
    status: "active",
    options: {},
    headers: {},
  }
}

describe("ProviderConfig.defaults", () => {
  // ============================================
  // EXPLICIT BREAKPOINT PROVIDERS
  // ============================================

  describe("anthropic", () => {
    const config = ProviderConfig.defaults.anthropic

    test("should have explicit-breakpoint cache type", () => {
      expect(config.cache.type).toBe("explicit-breakpoint")
    })

    test("should use cacheControl property", () => {
      expect(config.cache.property).toBe("cacheControl")
    })

    test("should have tools→system→messages hierarchy", () => {
      expect(config.cache.hierarchy).toEqual(["tools", "system", "messages"])
    })

    test("should have 5m default TTL", () => {
      expect(config.cache.ttl).toBe("5m")
    })

    test("should have maxBreakpoints of 4", () => {
      expect(config.cache.maxBreakpoints).toBe(4)
    })

    test("should be enabled", () => {
      expect(config.cache.enabled).toBe(true)
    })

    test("should have tools-first ordering", () => {
      expect(config.promptOrder.ordering[0]).toBe("tools")
    })

    test("should cache tools, system, and messages", () => {
      expect(config.promptOrder.cacheBreakpoints).toContain("tools")
      expect(config.promptOrder.cacheBreakpoints).toContain("system")
      expect(config.promptOrder.cacheBreakpoints).toContain("messages")
    })

    test("should not combine system messages (supports multiple for caching)", () => {
      expect(config.promptOrder.combineSystemMessages).toBe(false)
    })
  })

  describe("amazon-bedrock", () => {
    const config = ProviderConfig.defaults["amazon-bedrock"]

    test("should have explicit-breakpoint cache type", () => {
      expect(config.cache.type).toBe("explicit-breakpoint")
    })

    test("should use cachePoint property (different from anthropic)", () => {
      expect(config.cache.property).toBe("cachePoint")
    })

    test("should have system→messages→tools hierarchy (different from Anthropic)", () => {
      expect(config.cache.hierarchy).toEqual(["system", "messages", "tools"])
    })

    test("should have system-first ordering", () => {
      expect(config.promptOrder.ordering[0]).toBe("system")
    })

    test("should have tools at end of ordering", () => {
      const ordering = config.promptOrder.ordering
      expect(ordering[ordering.length - 1]).toBe("tools")
    })
  })

  describe("google-vertex-anthropic", () => {
    const config = ProviderConfig.defaults["google-vertex-anthropic"]

    test("should have explicit-breakpoint cache type (Anthropic-style)", () => {
      expect(config.cache.type).toBe("explicit-breakpoint")
    })

    test("should use cacheControl property (same as Anthropic)", () => {
      expect(config.cache.property).toBe("cacheControl")
    })

    test("should have same hierarchy as Anthropic", () => {
      expect(config.cache.hierarchy).toEqual(ProviderConfig.defaults.anthropic.cache.hierarchy)
    })
  })

  // ============================================
  // AUTOMATIC PREFIX PROVIDERS
  // ============================================

  describe("openai", () => {
    const config = ProviderConfig.defaults.openai

    test("should have automatic-prefix cache type", () => {
      expect(config.cache.type).toBe("automatic-prefix")
    })

    test("should have null property (automatic caching)", () => {
      expect(config.cache.property).toBeNull()
    })

    test("should have empty hierarchy (prefix-based)", () => {
      expect(config.cache.hierarchy).toEqual([])
    })

    test("should have auto TTL", () => {
      expect(config.cache.ttl).toBe("auto")
    })

    test("should have 1024 minTokens", () => {
      expect(config.cache.minTokens).toBe(1024)
    })

    test("should have instructions-first ordering (static content first)", () => {
      expect(config.promptOrder.ordering[0]).toBe("instructions")
    })

    test("should have no cache breakpoints (automatic)", () => {
      expect(config.promptOrder.cacheBreakpoints).toEqual([])
    })

    test("should combine system messages", () => {
      expect(config.promptOrder.combineSystemMessages).toBe(true)
    })
  })

  describe("azure", () => {
    const config = ProviderConfig.defaults.azure

    test("should match openai config type (same API)", () => {
      expect(config.cache.type).toBe(ProviderConfig.defaults.openai.cache.type)
    })

    test("should match openai ordering", () => {
      expect(config.promptOrder.ordering).toEqual(ProviderConfig.defaults.openai.promptOrder.ordering)
    })
  })

  describe("github-copilot", () => {
    const config = ProviderConfig.defaults["github-copilot"]

    test("should have automatic-prefix cache type", () => {
      expect(config.cache.type).toBe("automatic-prefix")
    })

    test("should match openai ordering (OpenAI-compatible)", () => {
      expect(config.promptOrder.ordering).toEqual(ProviderConfig.defaults.openai.promptOrder.ordering)
    })
  })

  describe("deepseek", () => {
    const config = ProviderConfig.defaults.deepseek

    test("should have automatic-prefix cache type", () => {
      expect(config.cache.type).toBe("automatic-prefix")
    })

    test("should have 0 minTokens (no minimum)", () => {
      expect(config.cache.minTokens).toBe(0)
    })
  })

  // ============================================
  // IMPLICIT CACHING PROVIDERS
  // ============================================

  describe("google", () => {
    const config = ProviderConfig.defaults.google

    test("should have implicit cache type", () => {
      expect(config.cache.type).toBe("implicit")
    })

    test("should have null property (implicit caching)", () => {
      expect(config.cache.property).toBeNull()
    })

    test("should have system-first ordering", () => {
      expect(config.promptOrder.ordering[0]).toBe("system")
    })

    test("should combine system messages for systemInstruction", () => {
      expect(config.promptOrder.combineSystemMessages).toBe(true)
    })
  })

  // ============================================
  // PASSTHROUGH PROVIDERS
  // ============================================

  describe("openrouter", () => {
    const config = ProviderConfig.defaults.openrouter

    test("should have passthrough cache type", () => {
      expect(config.cache.type).toBe("passthrough")
    })

    test("should use cache_control property", () => {
      expect(config.cache.property).toBe("cache_control")
    })

    test("should have tools-first ordering (optimized for Anthropic)", () => {
      expect(config.promptOrder.ordering[0]).toBe("tools")
    })

    test("should cache tools and system", () => {
      expect(config.promptOrder.cacheBreakpoints).toContain("tools")
      expect(config.promptOrder.cacheBreakpoints).toContain("system")
    })
  })

  // ============================================
  // NO CACHING PROVIDERS
  // ============================================

  describe("mistral", () => {
    const config = ProviderConfig.defaults.mistral

    test("should have caching disabled", () => {
      expect(config.cache.enabled).toBe(false)
    })

    test("should have none cache type", () => {
      expect(config.cache.type).toBe("none")
    })

    test("should have standard ordering", () => {
      expect(config.promptOrder.ordering[0]).toBe("system")
    })

    test("should have no cache breakpoints", () => {
      expect(config.promptOrder.cacheBreakpoints).toEqual([])
    })
  })

  describe("qwen", () => {
    test("should have caching disabled", () => {
      expect(ProviderConfig.defaults.qwen.cache.enabled).toBe(false)
    })
  })

  describe("cerebras", () => {
    test("should have caching disabled", () => {
      expect(ProviderConfig.defaults.cerebras.cache.enabled).toBe(false)
    })
  })

  // ============================================
  // DEFAULT FALLBACK
  // ============================================

  describe("default", () => {
    const config = ProviderConfig.defaults.default

    test("should have caching disabled", () => {
      expect(config.cache.enabled).toBe(false)
    })

    test("should have none cache type", () => {
      expect(config.cache.type).toBe("none")
    })

    test("should have standard ordering", () => {
      expect(config.promptOrder.ordering).toEqual(["system", "instructions", "environment", "tools", "messages"])
    })
  })

  // ============================================
  // ALL PROVIDERS VALIDATION
  // ============================================

  describe("all providers", () => {
    const allProviders = Object.keys(ProviderConfig.defaults)

    test.each(allProviders)("%s should have valid cache config", (providerID) => {
      const config = ProviderConfig.defaults[providerID]
      expect(config.cache).toBeDefined()
      expect(config.cache.enabled).toBeDefined()
      expect(config.cache.type).toBeDefined()
      expect(["explicit-breakpoint", "automatic-prefix", "implicit", "passthrough", "none"]).toContain(
        config.cache.type,
      )
    })

    test.each(allProviders)("%s should have valid promptOrder config", (providerID) => {
      const config = ProviderConfig.defaults[providerID]
      expect(config.promptOrder).toBeDefined()
      expect(config.promptOrder.ordering).toBeDefined()
      expect(Array.isArray(config.promptOrder.ordering)).toBe(true)
      expect(config.promptOrder.cacheBreakpoints).toBeDefined()
      expect(Array.isArray(config.promptOrder.cacheBreakpoints)).toBe(true)
      expect(typeof config.promptOrder.combineSystemMessages).toBe("boolean")
    })

    test.each(allProviders)("%s ordering should contain all required sections", (providerID) => {
      const ordering = ProviderConfig.defaults[providerID].promptOrder.ordering
      expect(ordering).toContain("system")
      expect(ordering).toContain("messages")
      expect(ordering).toContain("tools")
    })

    test.each(allProviders)("%s cacheBreakpoints should be subset of ordering", (providerID) => {
      const { ordering, cacheBreakpoints } = ProviderConfig.defaults[providerID].promptOrder
      for (const breakpoint of cacheBreakpoints) {
        expect(ordering).toContain(breakpoint)
      }
    })
  })
})

describe("ProviderConfig.resolveMinTokens", () => {
  test("should return number directly if minTokens is a number", () => {
    const result = ProviderConfig.resolveMinTokens(1024, undefined)
    expect(result).toBe(1024)
  })

  test("should return default for unknown model", () => {
    const minTokens = {
      "claude-opus-4": 4096,
      default: 1024,
    }
    const model = createMockModel("anthropic", "unknown-model")
    const result = ProviderConfig.resolveMinTokens(minTokens, model)
    expect(result).toBe(1024)
  })

  test("should match model ID pattern", () => {
    const minTokens = {
      "claude-opus-4": 4096,
      "claude-haiku-3.5": 2048,
      default: 1024,
    }
    const model = createMockModel("anthropic", "claude-opus-4-20250514")
    const result = ProviderConfig.resolveMinTokens(minTokens, model)
    expect(result).toBe(4096)
  })

  test("should match model family", () => {
    const minTokens = {
      "claude-opus-4": 4096,
      default: 1024,
    }
    const model = createMockModel("anthropic", "some-model", "claude-opus-4")
    const result = ProviderConfig.resolveMinTokens(minTokens, model)
    expect(result).toBe(4096)
  })

  test("should return default when no model provided", () => {
    const minTokens = {
      "claude-opus-4": 4096,
      default: 1024,
    }
    const result = ProviderConfig.resolveMinTokens(minTokens, undefined)
    expect(result).toBe(1024)
  })
})

describe("ProviderConfig.detectEffectiveProvider", () => {
  test("should return original provider for non-openrouter", () => {
    const model = createMockModel("anthropic", "claude-3.5-sonnet")
    expect(ProviderConfig.detectEffectiveProvider(model)).toBe("anthropic")
  })

  test("should detect anthropic for openrouter with claude model", () => {
    const model = createMockModel("openrouter", "anthropic/claude-3.5-sonnet")
    expect(ProviderConfig.detectEffectiveProvider(model)).toBe("anthropic")
  })

  test("should detect openai for openrouter with gpt model", () => {
    const model = createMockModel("openrouter", "openai/gpt-4")
    expect(ProviderConfig.detectEffectiveProvider(model)).toBe("openai")
  })

  test("should detect google for openrouter with gemini model", () => {
    const model = createMockModel("openrouter", "google/gemini-2.5-flash")
    expect(ProviderConfig.detectEffectiveProvider(model)).toBe("google")
  })

  test("should return openrouter for unknown model", () => {
    const model = createMockModel("openrouter", "unknown/some-model")
    expect(ProviderConfig.detectEffectiveProvider(model)).toBe("openrouter")
  })
})

describe("ProviderConfig.getConfig", () => {
  describe("provider defaults only", () => {
    test("should return anthropic defaults for anthropic provider", () => {
      const config = ProviderConfig.getConfig("anthropic")
      expect(config.cache.type).toBe("explicit-breakpoint")
      expect(config.cache.property).toBe("cacheControl")
    })

    test("should return openai defaults for openai provider", () => {
      const config = ProviderConfig.getConfig("openai")
      expect(config.cache.type).toBe("automatic-prefix")
    })

    test("should return default config for unknown provider", () => {
      const config = ProviderConfig.getConfig("unknown-provider")
      expect(config.cache.enabled).toBe(false)
      expect(config.cache.type).toBe("none")
    })
  })

  describe("user provider config overrides", () => {
    test("should merge user provider config with defaults", () => {
      const userConfig: ProviderConfig.UserConfig = {
        cache: {
          ttl: "1h",
        },
      }
      const config = ProviderConfig.getConfig("anthropic", undefined, undefined, userConfig)
      expect(config.cache.ttl).toBe("1h") // overridden
      expect(config.cache.type).toBe("explicit-breakpoint") // from defaults
      expect(config.cache.property).toBe("cacheControl") // from defaults
    })

    test("should override minTokens when specified", () => {
      const userConfig: ProviderConfig.UserConfig = {
        cache: {
          minTokens: 2048,
        },
      }
      const config = ProviderConfig.getConfig("anthropic", undefined, undefined, userConfig)
      expect(config.cache.minTokens).toBe(2048)
    })

    test("should disable caching when enabled: false", () => {
      const userConfig: ProviderConfig.UserConfig = {
        cache: {
          enabled: false,
        },
      }
      const config = ProviderConfig.getConfig("anthropic", undefined, undefined, userConfig)
      expect(config.cache.enabled).toBe(false)
    })
  })

  describe("user agent config overrides", () => {
    test("should apply agent-specific TTL", () => {
      const agentConfig: ProviderConfig.UserConfig = {
        cache: {
          ttl: "1h",
        },
      }
      const config = ProviderConfig.getConfig("anthropic", undefined, "task", undefined, agentConfig)
      expect(config.cache.ttl).toBe("1h")
    })

    test("should disable caching for specific agent", () => {
      const agentConfig: ProviderConfig.UserConfig = {
        cache: {
          enabled: false,
        },
      }
      const config = ProviderConfig.getConfig("anthropic", undefined, "title", undefined, agentConfig)
      expect(config.cache.enabled).toBe(false)
    })
  })

  describe("full config hierarchy", () => {
    test("should apply hierarchy: defaults < provider < agent", () => {
      const providerConfig: ProviderConfig.UserConfig = {
        cache: {
          ttl: "5m",
          minTokens: 2048,
        },
      }
      const agentConfig: ProviderConfig.UserConfig = {
        cache: {
          ttl: "1h", // overrides provider
        },
      }
      const config = ProviderConfig.getConfig("anthropic", undefined, "task", providerConfig, agentConfig)
      expect(config.cache.ttl).toBe("1h") // from agent
      expect(config.cache.minTokens).toBe(2048) // from provider
      expect(config.cache.type).toBe("explicit-breakpoint") // from defaults
    })
  })

  describe("model-specific resolution", () => {
    test("should resolve minTokens for claude-opus-4", () => {
      const model = createMockModel("anthropic", "claude-opus-4-20250514")
      const config = ProviderConfig.getConfig("anthropic", model)
      expect(config.cache.minTokens).toBe(4096)
    })

    test("should resolve minTokens for claude-haiku-3.5", () => {
      const model = createMockModel("anthropic", "claude-3-5-haiku-20241022")
      const config = ProviderConfig.getConfig("anthropic", model)
      expect(config.cache.minTokens).toBe(2048)
    })

    test("should use default minTokens for unknown model", () => {
      const model = createMockModel("anthropic", "claude-unknown-model")
      const config = ProviderConfig.getConfig("anthropic", model)
      expect(config.cache.minTokens).toBe(1024)
    })
  })
})

describe("ProviderConfig.supportsExplicitCaching", () => {
  test("should return true for anthropic", () => {
    expect(ProviderConfig.supportsExplicitCaching("anthropic")).toBe(true)
  })

  test("should return true for amazon-bedrock", () => {
    expect(ProviderConfig.supportsExplicitCaching("amazon-bedrock")).toBe(true)
  })

  test("should return true for openrouter (passthrough)", () => {
    expect(ProviderConfig.supportsExplicitCaching("openrouter")).toBe(true)
  })

  test("should return false for openai", () => {
    expect(ProviderConfig.supportsExplicitCaching("openai")).toBe(false)
  })

  test("should return false for google", () => {
    expect(ProviderConfig.supportsExplicitCaching("google")).toBe(false)
  })

  test("should return false for mistral", () => {
    expect(ProviderConfig.supportsExplicitCaching("mistral")).toBe(false)
  })

  test("should return false for unknown provider", () => {
    expect(ProviderConfig.supportsExplicitCaching("unknown")).toBe(false)
  })
})

describe("ProviderConfig.getCacheProperty", () => {
  test("should return cacheControl for anthropic", () => {
    expect(ProviderConfig.getCacheProperty("anthropic")).toBe("cacheControl")
  })

  test("should return cachePoint for bedrock", () => {
    expect(ProviderConfig.getCacheProperty("amazon-bedrock")).toBe("cachePoint")
  })

  test("should return cache_control for openrouter", () => {
    expect(ProviderConfig.getCacheProperty("openrouter")).toBe("cache_control")
  })

  test("should return null for openai", () => {
    expect(ProviderConfig.getCacheProperty("openai")).toBeNull()
  })
})

describe("ProviderConfig.isCachingEnabled", () => {
  test("should return true for anthropic by default", () => {
    expect(ProviderConfig.isCachingEnabled("anthropic")).toBe(true)
  })

  test("should return false for mistral", () => {
    expect(ProviderConfig.isCachingEnabled("mistral")).toBe(false)
  })

  test("should return false when user disables caching", () => {
    const userConfig: ProviderConfig.UserConfig = {
      cache: { enabled: false },
    }
    expect(ProviderConfig.isCachingEnabled("anthropic", undefined, userConfig)).toBe(false)
  })
})

describe("ProviderConfig.getProviderOptionsKey", () => {
  test("should return anthropic for @ai-sdk/anthropic", () => {
    expect(ProviderConfig.getProviderOptionsKey("@ai-sdk/anthropic", "anthropic")).toBe("anthropic")
  })

  test("should return bedrock for @ai-sdk/amazon-bedrock", () => {
    expect(ProviderConfig.getProviderOptionsKey("@ai-sdk/amazon-bedrock", "amazon-bedrock")).toBe("bedrock")
  })

  test("should return openrouter for @openrouter/ai-sdk-provider", () => {
    expect(ProviderConfig.getProviderOptionsKey("@openrouter/ai-sdk-provider", "openrouter")).toBe("openrouter")
  })

  test("should return providerID for unknown npm", () => {
    expect(ProviderConfig.getProviderOptionsKey("@unknown/sdk", "custom")).toBe("custom")
  })
})

describe("ProviderConfig.buildCacheControl", () => {
  test("should return ephemeral for anthropic", () => {
    const result = ProviderConfig.buildCacheControl("anthropic")
    expect(result).toEqual({ type: "ephemeral" })
  })

  test("should return ephemeral for openrouter", () => {
    const result = ProviderConfig.buildCacheControl("openrouter")
    expect(result).toEqual({ type: "ephemeral" })
  })

  test("should return empty object for openai", () => {
    const result = ProviderConfig.buildCacheControl("openai")
    expect(result).toEqual({})
  })

  test("should return empty object for mistral", () => {
    const result = ProviderConfig.buildCacheControl("mistral")
    expect(result).toEqual({})
  })
})

describe("ProviderConfig.getPromptOrdering", () => {
  test("should return tools-first for anthropic", () => {
    const model = createMockModel("anthropic", "claude-3.5-sonnet")
    const ordering = ProviderConfig.getPromptOrdering(model)
    expect(ordering[0]).toBe("tools")
  })

  test("should return system-first for bedrock", () => {
    const model = createMockModel("amazon-bedrock", "anthropic.claude-3-sonnet")
    const ordering = ProviderConfig.getPromptOrdering(model)
    expect(ordering[0]).toBe("system")
  })

  test("should return instructions-first for openai", () => {
    const model = createMockModel("openai", "gpt-4")
    const ordering = ProviderConfig.getPromptOrdering(model)
    expect(ordering[0]).toBe("instructions")
  })

  test("should use custom ordering from user config", () => {
    const model = createMockModel("anthropic", "claude-3.5-sonnet")
    const userConfig: ProviderConfig.UserConfig = {
      promptOrder: {
        ordering: ["system", "tools", "messages", "instructions", "environment"],
      },
    }
    const ordering = ProviderConfig.getPromptOrdering(model, undefined, userConfig)
    expect(ordering[0]).toBe("system")
  })
})

// ============================================
// PROMPT ORDER CONFIG TESTS
// ============================================

describe("ProviderConfig PromptOrderConfig fields", () => {
  describe("systemPromptMode", () => {
    test("anthropic uses parameter mode", () => {
      const config = ProviderConfig.defaults.anthropic
      expect(config.promptOrder.systemPromptMode).toBe("parameter")
    })

    test("openai uses role mode", () => {
      const config = ProviderConfig.defaults.openai
      expect(config.promptOrder.systemPromptMode).toBe("role")
    })

    test("google uses systemInstruction mode", () => {
      const config = ProviderConfig.defaults.google
      expect(config.promptOrder.systemPromptMode).toBe("systemInstruction")
    })

    test("amazon-bedrock uses parameter mode", () => {
      const config = ProviderConfig.defaults["amazon-bedrock"]
      expect(config.promptOrder.systemPromptMode).toBe("parameter")
    })

    test("azure uses role mode", () => {
      const config = ProviderConfig.defaults.azure
      expect(config.promptOrder.systemPromptMode).toBe("role")
    })

    test("mistral uses role mode", () => {
      const config = ProviderConfig.defaults.mistral
      expect(config.promptOrder.systemPromptMode).toBe("role")
    })
  })

  describe("toolCaching", () => {
    test("anthropic supports tool caching", () => {
      const config = ProviderConfig.defaults.anthropic
      expect(config.promptOrder.toolCaching).toBe(true)
    })

    test("amazon-bedrock supports tool caching", () => {
      const config = ProviderConfig.defaults["amazon-bedrock"]
      expect(config.promptOrder.toolCaching).toBe(true)
    })

    test("google-vertex-anthropic supports tool caching", () => {
      const config = ProviderConfig.defaults["google-vertex-anthropic"]
      expect(config.promptOrder.toolCaching).toBe(true)
    })

    test("openrouter supports tool caching (passthrough)", () => {
      const config = ProviderConfig.defaults.openrouter
      expect(config.promptOrder.toolCaching).toBe(true)
    })

    test("openai does not support tool caching", () => {
      const config = ProviderConfig.defaults.openai
      expect(config.promptOrder.toolCaching).toBe(false)
    })

    test("google does not support tool caching", () => {
      const config = ProviderConfig.defaults.google
      expect(config.promptOrder.toolCaching).toBe(false)
    })
  })

  describe("requiresAlternatingRoles", () => {
    test("anthropic requires alternating roles", () => {
      const config = ProviderConfig.defaults.anthropic
      expect(config.promptOrder.requiresAlternatingRoles).toBe(true)
    })

    test("google requires alternating roles", () => {
      const config = ProviderConfig.defaults.google
      expect(config.promptOrder.requiresAlternatingRoles).toBe(true)
    })

    test("openai does not require alternating roles", () => {
      const config = ProviderConfig.defaults.openai
      expect(config.promptOrder.requiresAlternatingRoles).toBe(false)
    })

    test("azure does not require alternating roles", () => {
      const config = ProviderConfig.defaults.azure
      expect(config.promptOrder.requiresAlternatingRoles).toBe(false)
    })
  })

  describe("sortTools", () => {
    test("anthropic sorts tools for cache consistency", () => {
      const config = ProviderConfig.defaults.anthropic
      expect(config.promptOrder.sortTools).toBe(true)
    })

    test("openai sorts tools for prefix cache consistency", () => {
      const config = ProviderConfig.defaults.openai
      expect(config.promptOrder.sortTools).toBe(true)
    })

    test("google does not sort tools (implicit caching)", () => {
      const config = ProviderConfig.defaults.google
      expect(config.promptOrder.sortTools).toBe(false)
    })

    test("mistral does not sort tools (no caching)", () => {
      const config = ProviderConfig.defaults.mistral
      expect(config.promptOrder.sortTools).toBe(false)
    })
  })

  describe("combineSystemMessages", () => {
    test("anthropic supports multiple system messages for cache breakpoints", () => {
      const config = ProviderConfig.defaults.anthropic
      expect(config.promptOrder.combineSystemMessages).toBe(false)
    })

    test("openai combines into single system message", () => {
      const config = ProviderConfig.defaults.openai
      expect(config.promptOrder.combineSystemMessages).toBe(true)
    })

    test("google combines into single system message", () => {
      const config = ProviderConfig.defaults.google
      expect(config.promptOrder.combineSystemMessages).toBe(true)
    })

    test("amazon-bedrock supports multiple system messages for cache breakpoints", () => {
      const config = ProviderConfig.defaults["amazon-bedrock"]
      expect(config.promptOrder.combineSystemMessages).toBe(false)
    })
  })
})

// ============================================
// INTEGRATION TESTS
// ============================================

describe("ProviderConfig.fromUserProviderConfig", () => {
  test("returns undefined for undefined input", () => {
    expect(ProviderConfig.fromUserProviderConfig(undefined)).toBeUndefined()
  })

  test("returns undefined when no cache or promptOrder provided", () => {
    expect(ProviderConfig.fromUserProviderConfig({})).toBeUndefined()
  })

  test("converts cache config correctly", () => {
    const input = {
      cache: {
        enabled: false,
        ttl: "1h" as const,
        minTokens: 2048,
        maxBreakpoints: 2,
      },
    }
    const result = ProviderConfig.fromUserProviderConfig(input)
    expect(result?.cache?.enabled).toBe(false)
    expect(result?.cache?.ttl).toBe("1h")
    expect(result?.cache?.minTokens).toBe(2048)
    expect(result?.cache?.maxBreakpoints).toBe(2)
  })

  test("converts promptOrder config correctly", () => {
    const input = {
      promptOrder: {
        ordering: ["system" as const, "tools" as const, "messages" as const],
        cacheBreakpoints: ["system" as const],
      },
    }
    const result = ProviderConfig.fromUserProviderConfig(input)
    expect(result?.promptOrder?.ordering).toEqual(["system", "tools", "messages"])
    expect(result?.promptOrder?.cacheBreakpoints).toEqual(["system"])
  })

  test("handles partial cache config", () => {
    const input = {
      cache: {
        ttl: "5m" as const,
      },
    }
    const result = ProviderConfig.fromUserProviderConfig(input)
    expect(result?.cache?.ttl).toBe("5m")
    expect(result?.cache?.enabled).toBeUndefined()
    expect(result?.cache?.minTokens).toBeUndefined()
  })

  test("converts both cache and promptOrder together", () => {
    const input = {
      cache: {
        enabled: true,
        ttl: "auto" as const,
      },
      promptOrder: {
        ordering: ["instructions" as const, "system" as const, "messages" as const],
      },
    }
    const result = ProviderConfig.fromUserProviderConfig(input)
    expect(result?.cache?.enabled).toBe(true)
    expect(result?.cache?.ttl).toBe("auto")
    expect(result?.promptOrder?.ordering).toEqual(["instructions", "system", "messages"])
  })
})

describe("ProviderConfig integration", () => {
  describe("caching + ordering consistency", () => {
    test("providers with tool caching should also support explicit caching", () => {
      for (const [providerID, config] of Object.entries(ProviderConfig.defaults)) {
        if (config.promptOrder.toolCaching) {
          const supportsExplicit = ProviderConfig.supportsExplicitCaching(providerID)
          expect(supportsExplicit).toBe(true)
        }
      }
    })

    test("providers that sort tools should have caching enabled", () => {
      for (const [providerID, config] of Object.entries(ProviderConfig.defaults)) {
        if (config.promptOrder.sortTools && providerID !== "default") {
          expect(config.cache.enabled).toBe(true)
        }
      }
    })
  })

  describe("provider behavior consistency", () => {
    test("all providers should have valid systemPromptMode", () => {
      const validModes: ProviderConfig.SystemPromptMode[] = ["role", "parameter", "systemInstruction"]
      for (const [providerID, config] of Object.entries(ProviderConfig.defaults)) {
        expect(validModes).toContain(config.promptOrder.systemPromptMode)
      }
    })

    test("all providers should have valid cache type", () => {
      const validTypes: ProviderConfig.CacheType[] = [
        "explicit-breakpoint",
        "automatic-prefix",
        "implicit",
        "passthrough",
        "none",
      ]
      for (const [providerID, config] of Object.entries(ProviderConfig.defaults)) {
        expect(validTypes).toContain(config.cache.type)
      }
    })

    test("all providers should have valid TTL", () => {
      const validTTLs: ProviderConfig.CacheTTL[] = ["5m", "1h", "auto"]
      for (const [providerID, config] of Object.entries(ProviderConfig.defaults)) {
        expect(validTTLs).toContain(config.cache.ttl)
      }
    })
  })
})
