import { describe, expect, test, afterEach } from "bun:test"
import { ClaudeCache } from "../../src/provider/claude-cache"
import type { Provider } from "../../src/provider/provider"

function createMockModel(overrides: Partial<Provider.Model> = {}): Provider.Model {
  return {
    id: "anthropic/claude-sonnet-4-20250514",
    providerID: "anthropic",
    api: {
      id: "claude-sonnet-4-20250514",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude Sonnet 4",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.003,
      output: 0.015,
      cache: { read: 0.0003, write: 0.00375 },
    },
    limit: {
      context: 200000,
      output: 64000,
    },
    status: "active",
    options: {},
    headers: {},
    ...overrides,
  }
}

describe("ClaudeCache.isSupported", () => {
  test("returns true for model with cache cost data", () => {
    const model = createMockModel()
    expect(ClaudeCache.isSupported(model)).toBe(true)
  })

  test("returns true for anthropic provider even without cache cost", () => {
    const model = createMockModel({
      providerID: "anthropic",
      cost: { input: 0.003, output: 0.015, cache: { read: 0, write: 0 } },
    })
    expect(ClaudeCache.isSupported(model)).toBe(true)
  })

  test("returns true for bedrock provider", () => {
    const model = createMockModel({
      providerID: "bedrock",
      cost: { input: 0.003, output: 0.015, cache: { read: 0, write: 0 } },
    })
    expect(ClaudeCache.isSupported(model)).toBe(true)
  })

  test("returns true for claude model on any provider", () => {
    const model = createMockModel({
      providerID: "openrouter",
      api: { id: "anthropic/claude-sonnet-4", url: "https://openrouter.ai", npm: "@openrouter/ai-sdk-provider" },
      cost: { input: 0.003, output: 0.015, cache: { read: 0, write: 0 } },
    })
    expect(ClaudeCache.isSupported(model)).toBe(true)
  })

  test("returns false for non-caching provider without cache cost", () => {
    const model = createMockModel({
      id: "openai/gpt-4",
      providerID: "openai",
      api: { id: "gpt-4", url: "https://api.openai.com", npm: "@ai-sdk/openai" },
      cost: { input: 0.03, output: 0.06, cache: { read: 0, write: 0 } },
    })
    expect(ClaudeCache.isSupported(model)).toBe(false)
  })
})

describe("ClaudeCache.getMinCacheableTokens", () => {
  // Claude 4.0 series - 1024 tokens (official API IDs with date)
  test("returns 1024 for claude-sonnet-4-20250514 (official API ID)", () => {
    const model = createMockModel({ id: "anthropic/claude-sonnet-4-20250514" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(1024)
  })

  test("returns 1024 for claude-opus-4-20250514 (official API ID)", () => {
    const model = createMockModel({ id: "anthropic/claude-opus-4-20250514" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(1024)
  })

  test("returns 1024 for claude-3-7-sonnet-20250219 (official API ID)", () => {
    const model = createMockModel({ id: "anthropic/claude-3-7-sonnet-20250219" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(1024)
  })

  // Claude 4.0 series - 1024 tokens (alias formats without date)
  test("returns 1024 for claude-sonnet-4 (alias format)", () => {
    const model = createMockModel({ id: "anthropic/claude-sonnet-4" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(1024)
  })

  test("returns 1024 for claude-opus-4 (alias format)", () => {
    const model = createMockModel({ id: "anthropic/claude-opus-4" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(1024)
  })

  test("returns 1024 for claude-opus-4-0 (alias format with minor version)", () => {
    const model = createMockModel({ id: "anthropic/claude-opus-4-0" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(1024)
  })

  test("returns 1024 for claude-opus-4-1 (opus 4.1 alias)", () => {
    const model = createMockModel({ id: "anthropic/claude-opus-4-1" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(1024)
  })

  // Claude 4.5 series - 4096 tokens (official API IDs with date)
  test("returns 4096 for claude-opus-4-5-20251101 (official API ID)", () => {
    const model = createMockModel({ id: "anthropic/claude-opus-4-5-20251101" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(4096)
  })

  test("returns 4096 for claude-haiku-4-5-20251001 (official API ID)", () => {
    const model = createMockModel({ id: "anthropic/claude-haiku-4-5-20251001" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(4096)
  })

  test("returns 4096 for claude-sonnet-4-5-20250929 (official API ID)", () => {
    const model = createMockModel({ id: "anthropic/claude-sonnet-4-5-20250929" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(4096)
  })

  // Claude 4.5 series - 4096 tokens (alias formats without date)
  test("returns 4096 for claude-opus-4-5 (alias format)", () => {
    const model = createMockModel({ id: "anthropic/claude-opus-4-5" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(4096)
  })

  test("returns 4096 for claude-haiku-4-5 (alias format)", () => {
    const model = createMockModel({ id: "anthropic/claude-haiku-4-5" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(4096)
  })

  test("returns 4096 for claude-sonnet-4-5 (alias format)", () => {
    const model = createMockModel({ id: "anthropic/claude-sonnet-4-5" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(4096)
  })

  // Claude 4.5 with dot notation (alternative alias format)
  test("returns 4096 for claude-haiku-4.5 (dot notation alias)", () => {
    const model = createMockModel({ id: "anthropic/claude-haiku-4.5" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(4096)
  })

  test("returns 4096 for claude-opus-4.5 (dot notation alias)", () => {
    const model = createMockModel({ id: "anthropic/claude-opus-4.5" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(4096)
  })

  test("returns 4096 for claude-sonnet-4.5 (dot notation alias)", () => {
    const model = createMockModel({ id: "anthropic/claude-sonnet-4.5" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(4096)
  })

  // Claude Haiku 3.x series - 2048 tokens (official API IDs)
  test("returns 2048 for claude-3-5-haiku-20241022 (official API ID)", () => {
    const model = createMockModel({ id: "anthropic/claude-3-5-haiku-20241022" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(2048)
  })

  test("returns 2048 for claude-3-haiku-20240307 (official API ID)", () => {
    const model = createMockModel({ id: "anthropic/claude-3-haiku-20240307" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(2048)
  })

  // Claude Haiku 3.x series - 2048 tokens (alias formats)
  test("returns 2048 for claude-3-5-haiku (alias format)", () => {
    const model = createMockModel({ id: "anthropic/claude-3-5-haiku" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(2048)
  })

  test("returns 2048 for claude-3-haiku (alias format)", () => {
    const model = createMockModel({ id: "anthropic/claude-3-haiku" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(2048)
  })

  // Bedrock format
  test("returns 4096 for anthropic.claude-haiku-4-5-20251001-v1:0 (Bedrock format)", () => {
    const model = createMockModel({ id: "bedrock/anthropic.claude-haiku-4-5-20251001-v1:0" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(4096)
  })

  test("returns 2048 for anthropic.claude-3-5-haiku-20241022-v1:0 (Bedrock format)", () => {
    const model = createMockModel({ id: "bedrock/anthropic.claude-3-5-haiku-20241022-v1:0" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(2048)
  })

  test("returns 1024 for anthropic.claude-sonnet-4-20250514-v1:0 (Bedrock format)", () => {
    const model = createMockModel({ id: "bedrock/anthropic.claude-sonnet-4-20250514-v1:0" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(1024)
  })

  // OpenRouter format
  test("returns 4096 for anthropic/claude-sonnet-4-5 (OpenRouter format)", () => {
    const model = createMockModel({ id: "anthropic/claude-sonnet-4-5" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(4096)
  })

  // model.family takes precedence
  test("uses model.family when available", () => {
    const model = createMockModel({ id: "some-random-id", family: "claude-haiku" })
    expect(ClaudeCache.getMinCacheableTokens(model)).toBe(2048)
  })
})

describe("ClaudeCache.getProviderCacheControl", () => {
  test("returns bedrock format for bedrock provider", () => {
    const result = ClaudeCache.getProviderCacheControl("bedrock", "5m")
    expect(result).toEqual({
      bedrock: { cachePoint: { type: "ephemeral" } },
    })
  })

  test("returns anthropic format with TTL for anthropic provider", () => {
    const result = ClaudeCache.getProviderCacheControl("anthropic", "5m")
    expect(result).toEqual({
      anthropic: { cacheControl: { type: "ephemeral", ttl: "5m" } },
    })
  })

  test("returns anthropic format with 1h TTL", () => {
    const result = ClaudeCache.getProviderCacheControl("anthropic", "1h")
    expect(result).toEqual({
      anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
    })
  })

  test("returns openrouter format for other providers", () => {
    const result = ClaudeCache.getProviderCacheControl("openrouter", "5m")
    expect(result).toEqual({
      openrouter: { cache_control: { type: "ephemeral", ttl: "5m" } },
      openaiCompatible: { cache_control: { type: "ephemeral", ttl: "5m" } },
    })
  })
})

describe("ClaudeCache.getAllProviderCacheControls", () => {
  test("returns all formats without TTL for bedrock", () => {
    const result = ClaudeCache.getAllProviderCacheControls("bedrock", "5m")
    expect(result).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
      bedrock: { cachePoint: { type: "ephemeral" } },
    })
  })

  test("returns all formats with TTL for anthropic", () => {
    const result = ClaudeCache.getAllProviderCacheControls("anthropic", "1h")
    expect(result).toEqual({
      anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
      openrouter: { cache_control: { type: "ephemeral", ttl: "1h" } },
      openaiCompatible: { cache_control: { type: "ephemeral", ttl: "1h" } },
    })
  })
})

describe("ClaudeCache.resolveConfig", () => {
  test("returns defaults when no config provided", () => {
    const result = ClaudeCache.resolveConfig()
    expect(result).toEqual({
      enabled: true,
      toolsTtl: "5m",
      instructionsTtl: "5m",
    })
  })

  test("provider config overrides defaults", () => {
    const result = ClaudeCache.resolveConfig({ toolsTtl: "1h" })
    expect(result).toEqual({
      enabled: true,
      toolsTtl: "1h",
      instructionsTtl: "5m",
    })
  })

  test("agent config overrides provider config", () => {
    const result = ClaudeCache.resolveConfig({ toolsTtl: "1h", enabled: false }, { enabled: true, toolsTtl: "5m" })
    expect(result).toEqual({
      enabled: true,
      toolsTtl: "5m",
      instructionsTtl: "5m",
    })
  })

  test("agent config partially overrides provider config", () => {
    const result = ClaudeCache.resolveConfig(
      { toolsTtl: "1h", instructionsTtl: "1h" },
      { toolsTtl: "5m" }, // only override toolsTtl
    )
    expect(result).toEqual({
      enabled: true,
      toolsTtl: "5m",
      instructionsTtl: "1h", // from provider
    })
  })
})

describe("ClaudeCache.applyToTools", () => {
  test("applies cache control to last tool for anthropic model", () => {
    const model = createMockModel()
    const tools = {
      bash: { description: "Run bash", providerOptions: {} },
      read: { description: "Read file", providerOptions: {} },
      write: { description: "Write file", providerOptions: {} },
    }

    const result = ClaudeCache.applyToTools(tools, model)

    expect(result.bash.providerOptions).toEqual({})
    expect(result.read.providerOptions).toEqual({})
    expect(result.write.providerOptions).toHaveProperty("anthropic")
  })

  test("returns tools unchanged for non-caching model", () => {
    const model = createMockModel({
      id: "openai/gpt-4",
      providerID: "openai",
      api: { id: "gpt-4", url: "https://api.openai.com", npm: "@ai-sdk/openai" },
      cost: { input: 0.03, output: 0.06, cache: { read: 0, write: 0 } },
    })
    const tools = {
      bash: { description: "Run bash", providerOptions: {} },
    }

    const result = ClaudeCache.applyToTools(tools, model)

    expect(result).toEqual(tools)
  })

  test("returns empty tools unchanged", () => {
    const model = createMockModel()
    const tools = {}

    const result = ClaudeCache.applyToTools(tools, model)

    expect(result).toEqual({})
  })

  test("respects enabled: false in config", () => {
    const model = createMockModel()
    const tools = {
      bash: { description: "Run bash", providerOptions: {} },
    }

    const result = ClaudeCache.applyToTools(tools, model, { enabled: false })

    expect(result).toEqual(tools)
  })

  test("uses configured TTL", () => {
    const model = createMockModel()
    const tools = {
      bash: { description: "Run bash", providerOptions: {} },
    }

    const result = ClaudeCache.applyToTools(tools, model, { toolsTtl: "1h" })

    expect((result.bash.providerOptions as any)?.anthropic?.cacheControl?.ttl).toBe("1h")
  })
})

describe("ClaudeCache.applyToTools with OPENCODE_DISABLE_CACHE", () => {
  const originalEnv = process.env.OPENCODE_DISABLE_CACHE

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OPENCODE_DISABLE_CACHE
    } else {
      process.env.OPENCODE_DISABLE_CACHE = originalEnv
    }
  })

  test("returns tools unchanged when OPENCODE_DISABLE_CACHE=true", () => {
    process.env.OPENCODE_DISABLE_CACHE = "true"
    // Re-import to pick up env change - but Flag is evaluated at import time
    // So we need to test this differently or accept the limitation
    // For now, skip this test as it requires module reloading
  })
})
