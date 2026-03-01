import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

const OUTPUT_TOKEN_MAX = 32000

describe("ProviderTransform.options - setCacheKey", () => {
  const sessionID = "test-session-123"

  const mockModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
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
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("should set promptCacheKey when providerOptions.setCacheKey is true", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: { setCacheKey: true },
    })
    expect(result.promptCacheKey).toBe(sessionID)
  })

  test("should not set promptCacheKey when providerOptions.setCacheKey is false", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: { setCacheKey: false },
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should not set promptCacheKey when providerOptions is undefined", () => {
    const result = ProviderTransform.options({
      model: mockModel,
      sessionID,
      providerOptions: undefined,
    })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should not set promptCacheKey when providerOptions does not have setCacheKey", () => {
    const result = ProviderTransform.options({ model: mockModel, sessionID, providerOptions: {} })
    expect(result.promptCacheKey).toBeUndefined()
  })

  test("should set promptCacheKey for openai provider regardless of setCacheKey", () => {
    const openaiModel = {
      ...mockModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }
    const result = ProviderTransform.options({ model: openaiModel, sessionID, providerOptions: {} })
    expect(result.promptCacheKey).toBe(sessionID)
  })

  test("should set store=false for openai provider", () => {
    const openaiModel = {
      ...mockModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }
    const result = ProviderTransform.options({
      model: openaiModel,
      sessionID,
      providerOptions: {},
    })
    expect(result.store).toBe(false)
  })
})

describe("ProviderTransform.options - gpt-5 textVerbosity", () => {
  const sessionID = "test-session-123"

  const createGpt5Model = (apiId: string) =>
    ({
      id: `openai/${apiId}`,
      providerID: "openai",
      api: {
        id: apiId,
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
      name: apiId,
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.03, output: 0.06, cache: { read: 0.001, write: 0.002 } },
      limit: { context: 128000, output: 4096 },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("gpt-5.2 should have textVerbosity set to low", () => {
    const model = createGpt5Model("gpt-5.2")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBe("low")
  })

  test("gpt-5.1 should have textVerbosity set to low", () => {
    const model = createGpt5Model("gpt-5.1")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBe("low")
  })

  test("gpt-5.2-chat-latest should NOT have textVerbosity set (only supports medium)", () => {
    const model = createGpt5Model("gpt-5.2-chat-latest")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5.1-chat-latest should NOT have textVerbosity set (only supports medium)", () => {
    const model = createGpt5Model("gpt-5.1-chat-latest")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5.2-chat should NOT have textVerbosity set", () => {
    const model = createGpt5Model("gpt-5.2-chat")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5-chat should NOT have textVerbosity set", () => {
    const model = createGpt5Model("gpt-5-chat")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("gpt-5.2-codex should NOT have textVerbosity set (codex models excluded)", () => {
    const model = createGpt5Model("gpt-5.2-codex")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result.textVerbosity).toBeUndefined()
  })
})

describe("ProviderTransform.options - gateway", () => {
  const sessionID = "test-session-123"

  const createModel = (id: string) =>
    ({
      id,
      providerID: "vercel",
      api: {
        id,
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
      name: id,
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
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 200_000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2024-01-01",
    }) as any

  test("puts gateway defaults under gateway key", () => {
    const model = createModel("anthropic/claude-sonnet-4")
    const result = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    expect(result).toEqual({
      gateway: {
        caching: "auto",
      },
    })
  })
})

describe("ProviderTransform.providerOptions", () => {
  const createModel = (overrides: Partial<any> = {}) =>
    ({
      id: "test/test-model",
      providerID: "test",
      api: {
        id: "test-model",
        url: "https://api.test.com",
        npm: "@ai-sdk/openai",
      },
      name: "Test Model",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: {
        input: 0.001,
        output: 0.002,
        cache: { read: 0.0001, write: 0.0002 },
      },
      limit: {
        context: 200_000,
        output: 64_000,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2024-01-01",
      ...overrides,
    }) as any

  test("uses sdk key for non-gateway models", () => {
    const model = createModel({
      providerID: "my-bedrock",
      api: {
        id: "anthropic.claude-sonnet-4",
        url: "https://bedrock.aws",
        npm: "@ai-sdk/amazon-bedrock",
      },
    })

    expect(ProviderTransform.providerOptions(model, { cachePoint: { type: "default" } })).toEqual({
      bedrock: { cachePoint: { type: "default" } },
    })
  })

  test("uses gateway model provider slug for gateway models", () => {
    const model = createModel({
      providerID: "vercel",
      api: {
        id: "anthropic/claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { thinking: { type: "enabled", budgetTokens: 12_000 } })).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 12_000 } },
    })
  })

  test("falls back to gateway key when gateway api id is unscoped", () => {
    const model = createModel({
      id: "anthropic/claude-sonnet-4",
      providerID: "vercel",
      api: {
        id: "claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { thinking: { type: "enabled", budgetTokens: 12_000 } })).toEqual({
      gateway: { thinking: { type: "enabled", budgetTokens: 12_000 } },
    })
  })

  test("splits gateway routing options from provider-specific options", () => {
    const model = createModel({
      providerID: "vercel",
      api: {
        id: "anthropic/claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(
      ProviderTransform.providerOptions(model, {
        gateway: { order: ["vertex", "anthropic"] },
        thinking: { type: "enabled", budgetTokens: 12_000 },
      }),
    ).toEqual({
      gateway: { order: ["vertex", "anthropic"] },
      anthropic: { thinking: { type: "enabled", budgetTokens: 12_000 } },
    } as any)
  })

  test("falls back to gateway key when model id has no provider slug", () => {
    const model = createModel({
      id: "claude-sonnet-4",
      providerID: "vercel",
      api: {
        id: "claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningEffort: "high" })).toEqual({
      gateway: { reasoningEffort: "high" },
    })
  })

  test("maps amazon slug to bedrock for provider options", () => {
    const model = createModel({
      providerID: "vercel",
      api: {
        id: "amazon/nova-2-lite",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningConfig: { type: "enabled" } })).toEqual({
      bedrock: { reasoningConfig: { type: "enabled" } },
    })
  })

  test("uses groq slug for groq models", () => {
    const model = createModel({
      providerID: "vercel",
      api: {
        id: "groq/llama-3.3-70b-versatile",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
      },
    })

    expect(ProviderTransform.providerOptions(model, { reasoningFormat: "parsed" })).toEqual({
      groq: { reasoningFormat: "parsed" },
    })
  })
})

describe("ProviderTransform.schema - gemini array items", () => {
  test("adds missing items for array properties", () => {
    const geminiModel = {
      providerID: "google",
      api: {
        id: "gemini-3-pro",
      },
    } as any

    const schema = {
      type: "object",
      properties: {
        nodes: { type: "array" },
        edges: { type: "array", items: { type: "string" } },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.nodes.items).toBeDefined()
    expect(result.properties.edges.items.type).toBe("string")
  })
})

describe("ProviderTransform.schema - gemini nested array items", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  test("adds type to 2D array with empty inner items", () => {
    const schema = {
      type: "object",
      properties: {
        values: {
          type: "array",
          items: {
            type: "array",
            items: {}, // Empty items object
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    // Inner items should have a default type
    expect(result.properties.values.items.items.type).toBe("string")
  })

  test("adds items and type to 2D array with missing inner items", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: { type: "array" }, // No items at all
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.items.items).toBeDefined()
    expect(result.properties.data.items.items.type).toBe("string")
  })

  test("handles deeply nested arrays (3D)", () => {
    const schema = {
      type: "object",
      properties: {
        matrix: {
          type: "array",
          items: {
            type: "array",
            items: {
              type: "array",
              // No items
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.matrix.items.items.items).toBeDefined()
    expect(result.properties.matrix.items.items.items.type).toBe("string")
  })

  test("preserves existing item types in nested arrays", () => {
    const schema = {
      type: "object",
      properties: {
        numbers: {
          type: "array",
          items: {
            type: "array",
            items: { type: "number" }, // Has explicit type
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    // Should preserve the explicit type
    expect(result.properties.numbers.items.items.type).toBe("number")
  })

  test("handles mixed nested structures with objects and arrays", () => {
    const schema = {
      type: "object",
      properties: {
        spreadsheetData: {
          type: "object",
          properties: {
            rows: {
              type: "array",
              items: {
                type: "array",
                items: {}, // Empty items
              },
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.spreadsheetData.properties.rows.items.items.type).toBe("string")
  })
})

describe("ProviderTransform.schema - gemini non-object properties removal", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  test("removes properties from non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "string",
          properties: { invalid: { type: "string" } },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("string")
    expect(result.properties.data.properties).toBeUndefined()
  })

  test("removes required from non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: { type: "string" },
          required: ["invalid"],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("array")
    expect(result.properties.data.required).toBeUndefined()
  })

  test("removes properties and required from nested non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: {
            inner: {
              type: "number",
              properties: { bad: { type: "string" } },
              required: ["bad"],
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.outer.properties.inner.type).toBe("number")
    expect(result.properties.outer.properties.inner.properties).toBeUndefined()
    expect(result.properties.outer.properties.inner.required).toBeUndefined()
  })

  test("keeps properties and required on object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.data.type).toBe("object")
    expect(result.properties.data.properties).toBeDefined()
    expect(result.properties.data.required).toEqual(["name"])
  })

  test("does not affect non-gemini providers", () => {
    const openaiModel = {
      providerID: "openai",
      api: {
        id: "gpt-4",
      },
    } as any

    const schema = {
      type: "object",
      properties: {
        data: {
          type: "string",
          properties: { invalid: { type: "string" } },
        },
      },
    } as any

    const result = ProviderTransform.schema(openaiModel, schema) as any

    expect(result.properties.data.properties).toBeDefined()
  })
})

describe("ProviderTransform.message - DeepSeek reasoning content", () => {
  test("DeepSeek with tool calls includes reasoning_content in providerOptions", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Let me think about this..." },
          {
            type: "tool-call",
            toolCallId: "test",
            toolName: "bash",
            input: { command: "echo hello" },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(
      msgs,
      {
        id: "deepseek/deepseek-chat",
        providerID: "deepseek",
        api: {
          id: "deepseek-chat",
          url: "https://api.deepseek.com",
          npm: "@ai-sdk/openai-compatible",
        },
        name: "DeepSeek Chat",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: {
            field: "reasoning_content",
          },
        },
        cost: {
          input: 0.001,
          output: 0.002,
          cache: { read: 0.0001, write: 0.0002 },
        },
        limit: {
          context: 128000,
          output: 8192,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2023-04-01",
      },
      {},
    )

    expect(result).toHaveLength(1)
    expect(result[0].content).toEqual([
      {
        type: "tool-call",
        toolCallId: "test",
        toolName: "bash",
        input: { command: "echo hello" },
      },
    ])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBe("Let me think about this...")
  })

  test("Non-DeepSeek providers leave reasoning content unchanged", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Should not be processed" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(
      msgs,
      {
        id: "openai/gpt-4",
        providerID: "openai",
        api: {
          id: "gpt-4",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        name: "GPT-4",
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: true,
          toolcall: true,
          input: { text: true, audio: false, image: true, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        cost: {
          input: 0.03,
          output: 0.06,
          cache: { read: 0.001, write: 0.002 },
        },
        limit: {
          context: 128000,
          output: 4096,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2023-04-01",
      },
      {},
    )

    expect(result[0].content).toEqual([
      { type: "reasoning", text: "Should not be processed" },
      { type: "text", text: "Answer" },
    ])
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBeUndefined()
  })
})

describe("ProviderTransform.message - empty image handling", () => {
  const mockModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
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
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("should replace empty base64 image with error text", () => {
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", image: "data:image/png;base64," },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "What is in this image?" })
    expect(result[0].content[1]).toEqual({
      type: "text",
      text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
    })
  })

  test("should keep valid base64 images unchanged", () => {
    const validBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", image: `data:image/png;base64,${validBase64}` },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "What is in this image?" })
    expect(result[0].content[1]).toEqual({ type: "image", image: `data:image/png;base64,${validBase64}` })
  })

  test("should handle mixed valid and empty images", () => {
    const validBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    const msgs = [
      {
        role: "user",
        content: [
          { type: "text", text: "Compare these images" },
          { type: "image", image: `data:image/png;base64,${validBase64}` },
          { type: "image", image: "data:image/jpeg;base64," },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mockModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(3)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Compare these images" })
    expect(result[0].content[1]).toEqual({ type: "image", image: `data:image/png;base64,${validBase64}` })
    expect(result[0].content[2]).toEqual({
      type: "text",
      text: "ERROR: Image file is empty or corrupted. Please provide a valid image.",
    })
  })
})

describe("ProviderTransform.message - databricks empty content filtering", () => {
  // Test with Databricks Claude (Anthropic model via OpenAI-compatible API)
  const databricksClaudeModel = {
    id: "databricks-claude-sonnet-4",
    providerID: "databricks",
    api: {
      id: "databricks-claude-sonnet-4",
      url: "https://my-workspace.cloud.databricks.com/serving-endpoints",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Claude Sonnet 4 (Databricks)",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 3,
      output: 15,
      cache: { read: 0.3, write: 0 },
    },
    limit: {
      context: 200000,
      output: 64000,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  // Test with Databricks GPT-5 (OpenAI model via OpenAI-compatible API)
  const databricksGptModel = {
    id: "databricks-gpt-5",
    providerID: "databricks",
    api: {
      id: "databricks-gpt-5",
      url: "https://my-workspace.cloud.databricks.com/serving-endpoints",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "GPT-5 (Databricks)",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 1.25,
      output: 10,
      cache: { read: 0.125, write: 0 },
    },
    limit: {
      context: 400000,
      output: 128000,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  // Test with Databricks Gemini (Google model via OpenAI-compatible API)
  const databricksGeminiModel = {
    id: "databricks-gemini-3-pro",
    providerID: "databricks",
    api: {
      id: "databricks-gemini-3-pro",
      url: "https://my-workspace.cloud.databricks.com/serving-endpoints",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Gemini 3 Pro (Databricks)",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: true, image: true, video: true, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 2,
      output: 12,
      cache: { read: 0.2, write: 0 },
    },
    limit: {
      context: 1000000,
      output: 65536,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  // Use databricksClaudeModel as the default for existing tests
  const databricksModel = databricksClaudeModel

  test("filters out messages with empty string content", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },
      { role: "user", content: "World" },
    ] as any[]

    const result = ProviderTransform.message(msgs, databricksModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toBe("World")
  })

  test("filters out empty text parts from array content", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "text", text: "Hello" },
          { type: "text", text: "" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, databricksModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toMatchObject({ type: "text", text: "Hello" })
  })

  test("keeps tool-call parts when text parts are empty", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "tool-call", toolCallId: "123", toolName: "bash", input: { command: "ls" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, databricksModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toMatchObject({
      type: "tool-call",
      toolCallId: "123",
      toolName: "bash",
      input: { command: "ls" },
    })
  })

  test("keeps tool-result parts when text parts are empty", () => {
    const msgs = [
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "123", toolName: "bash", result: "output" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, databricksModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
  })

  test("removes entire message when all parts are empty", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "reasoning", text: "" },
        ],
      },
      { role: "user", content: "World" },
    ] as any[]

    const result = ProviderTransform.message(msgs, databricksModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toBe("World")
  })

  test("handles assistant message with only tool call (no text)", () => {
    const msgs = [
      { role: "user", content: "Run a command" },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "call_123", toolName: "bash", input: { command: "ls" } }],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "call_123", toolName: "bash", result: "file1.txt" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, databricksModel, {})

    expect(result).toHaveLength(3)
    // Assistant message should just have tool call, no text
    expect(result[1].content).toHaveLength(1)
    expect(result[1].content[0]).toMatchObject({ type: "tool-call", toolCallId: "call_123" })
    // Tool result should be preserved
    expect(result[2].content).toHaveLength(1)
    expect(result[2].content[0]).toMatchObject({ type: "tool-result", toolCallId: "call_123" })
  })

  test("handles empty text alongside tool call (empty text should be filtered)", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "tool-call", toolCallId: "call_123", toolName: "bash", input: { command: "ls" } },
          { type: "text", text: "" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, databricksModel, {})

    expect(result).toHaveLength(1)
    // Empty text parts should be filtered, only tool call remains
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toMatchObject({ type: "tool-call" })
  })

  // Explicit tool calling tests for each Databricks model type

  describe("Databricks Claude (Anthropic) - tool calling", () => {
    test("filters empty text and keeps tool calls", () => {
      const msgs = [
        { role: "user", content: "Run a command" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "" },
            { type: "tool-call", toolCallId: "claude_call_1", toolName: "bash", input: { command: "echo hello" } },
          ],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "claude_call_1", toolName: "bash", result: "hello" }],
        },
      ] as any[]

      const result = ProviderTransform.message(msgs, databricksClaudeModel, {})

      expect(result).toHaveLength(3)
      // Assistant message: empty text filtered, tool call preserved
      expect(result[1].content).toHaveLength(1)
      expect(result[1].content[0]).toMatchObject({
        type: "tool-call",
        toolCallId: "claude_call_1",
        toolName: "bash",
      })
      // Tool result preserved
      expect(result[2].content[0]).toMatchObject({
        type: "tool-result",
        toolCallId: "claude_call_1",
      })
    })

    test("handles multiple tool calls with empty text", () => {
      const msgs = [
        {
          role: "assistant",
          content: [
            { type: "text", text: "" },
            { type: "tool-call", toolCallId: "call_1", toolName: "read", input: { file: "foo.ts" } },
            { type: "text", text: "" },
            { type: "tool-call", toolCallId: "call_2", toolName: "edit", input: { file: "bar.ts" } },
            { type: "text", text: "" },
          ],
        },
      ] as any[]

      const result = ProviderTransform.message(msgs, databricksClaudeModel, {})

      expect(result).toHaveLength(1)
      // All empty text parts filtered, both tool calls preserved
      expect(result[0].content).toHaveLength(2)
      expect(result[0].content[0]).toMatchObject({ type: "tool-call", toolCallId: "call_1" })
      expect(result[0].content[1]).toMatchObject({ type: "tool-call", toolCallId: "call_2" })
    })
  })

  describe("Databricks GPT-5 (OpenAI) - tool calling", () => {
    test("filters empty text and keeps tool calls", () => {
      const msgs = [
        { role: "user", content: "List files" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "" },
            { type: "tool-call", toolCallId: "gpt_call_1", toolName: "bash", input: { command: "ls -la" } },
          ],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "gpt_call_1", toolName: "bash", result: "total 0\ndrwxr-xr-x" }],
        },
      ] as any[]

      const result = ProviderTransform.message(msgs, databricksGptModel, {})

      expect(result).toHaveLength(3)
      // Assistant message: empty text filtered, tool call preserved
      expect(result[1].content).toHaveLength(1)
      expect(result[1].content[0]).toMatchObject({
        type: "tool-call",
        toolCallId: "gpt_call_1",
        toolName: "bash",
      })
      // Tool result preserved
      expect(result[2].content[0]).toMatchObject({
        type: "tool-result",
        toolCallId: "gpt_call_1",
      })
    })

    test("handles reasoning with tool calls (empty reasoning filtered)", () => {
      const msgs = [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "" },
            { type: "tool-call", toolCallId: "gpt_reason_call", toolName: "read", input: { file: "config.json" } },
          ],
        },
      ] as any[]

      const result = ProviderTransform.message(msgs, databricksGptModel, {})

      expect(result).toHaveLength(1)
      // Empty reasoning filtered, tool call preserved
      expect(result[0].content).toHaveLength(1)
      expect(result[0].content[0]).toMatchObject({ type: "tool-call", toolCallId: "gpt_reason_call" })
    })
  })

  describe("Databricks Gemini (Google) - tool calling", () => {
    test("filters empty text and keeps tool calls", () => {
      const msgs = [
        { role: "user", content: "Search for files" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "" },
            { type: "tool-call", toolCallId: "gemini_call_1", toolName: "glob", input: { pattern: "**/*.ts" } },
          ],
        },
        {
          role: "tool",
          content: [
            { type: "tool-result", toolCallId: "gemini_call_1", toolName: "glob", result: "src/index.ts\nsrc/app.ts" },
          ],
        },
      ] as any[]

      const result = ProviderTransform.message(msgs, databricksGeminiModel, {})

      expect(result).toHaveLength(3)
      // Assistant message: empty text filtered, tool call preserved
      expect(result[1].content).toHaveLength(1)
      expect(result[1].content[0]).toMatchObject({
        type: "tool-call",
        toolCallId: "gemini_call_1",
        toolName: "glob",
      })
      // Tool result preserved
      expect(result[2].content[0]).toMatchObject({
        type: "tool-result",
        toolCallId: "gemini_call_1",
      })
    })

    test("handles multi-turn conversation with tools", () => {
      const msgs = [
        { role: "user", content: "Read the config" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "" },
            { type: "tool-call", toolCallId: "gem_1", toolName: "read", input: { file: "config.json" } },
          ],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "gem_1", toolName: "read", result: '{"debug": true}' }],
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "The config has debug enabled. Let me update it." },
            {
              type: "tool-call",
              toolCallId: "gem_2",
              toolName: "edit",
              input: { file: "config.json", content: '{"debug": false}' },
            },
          ],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "gem_2", toolName: "edit", result: "File updated" }],
        },
      ] as any[]

      const result = ProviderTransform.message(msgs, databricksGeminiModel, {})

      expect(result).toHaveLength(5)
      // First assistant: only tool call (empty text filtered)
      expect(result[1].content).toHaveLength(1)
      expect(result[1].content[0]).toMatchObject({ type: "tool-call" })
      // Second assistant: text + tool call preserved
      expect(result[3].content).toHaveLength(2)
      expect(result[3].content[0]).toMatchObject({
        type: "text",
        text: "The config has debug enabled. Let me update it.",
      })
      expect(result[3].content[1]).toMatchObject({ type: "tool-call" })
    })
  })
})

describe("ProviderTransform.message - anthropic empty content filtering", () => {
  const anthropicModel = {
    id: "anthropic/claude-3-5-sonnet",
    providerID: "anthropic",
    api: {
      id: "claude-3-5-sonnet-20241022",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude 3.5 Sonnet",
    capabilities: {
      temperature: true,
      reasoning: false,
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
      output: 8192,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("filters out messages with empty string content", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },
      { role: "user", content: "World" },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toBe("World")
  })

  test("filters out empty text parts from array content", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "text", text: "Hello" },
          { type: "text", text: "" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Hello" })
  })

  test("filters out empty reasoning parts from array content", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "" },
          { type: "text", text: "Answer" },
          { type: "reasoning", text: "" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Answer" })
  })

  test("removes entire message when all parts are empty", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "reasoning", text: "" },
        ],
      },
      { role: "user", content: "World" },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toBe("World")
  })

  test("keeps non-text/reasoning parts even if text parts are empty", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "tool-call", toolCallId: "123", toolName: "bash", input: { command: "ls" } },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({
      type: "tool-call",
      toolCallId: "123",
      toolName: "bash",
      input: { command: "ls" },
    })
  })

  test("keeps messages with valid text alongside empty parts", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Thinking..." },
          { type: "text", text: "" },
          { type: "text", text: "Result" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "reasoning", text: "Thinking..." })
    expect(result[0].content[1]).toEqual({ type: "text", text: "Result" })
  })

  test("does not filter for non-anthropic providers", () => {
    const openaiModel = {
      ...anthropicModel,
      providerID: "openai",
      api: {
        id: "gpt-4",
        url: "https://api.openai.com",
        npm: "@ai-sdk/openai",
      },
    }

    const msgs = [
      { role: "assistant", content: "" },
      {
        role: "assistant",
        content: [{ type: "text", text: "" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("")
    expect(result[1].content).toHaveLength(1)
  })
})

describe("ProviderTransform.message - strip openai metadata when store=false", () => {
  const openaiModel = {
    id: "openai/gpt-5",
    providerID: "openai",
    api: {
      id: "gpt-5",
      url: "https://api.openai.com",
      npm: "@ai-sdk/openai",
    },
    name: "GPT-5",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.03, output: 0.06, cache: { read: 0.001, write: 0.002 } },
    limit: { context: 128000, output: 4096 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("preserves itemId and reasoningEncryptedContent when store=false", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking...",
            providerOptions: {
              openai: {
                itemId: "rs_123",
                reasoningEncryptedContent: "encrypted",
              },
            },
          },
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_456",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, { store: false }) as any[]

    expect(result).toHaveLength(1)
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("rs_123")
    expect(result[0].content[1].providerOptions?.openai?.itemId).toBe("msg_456")
  })

  test("preserves itemId and reasoningEncryptedContent when store=false even when not openai", () => {
    const zenModel = {
      ...openaiModel,
      providerID: "zen",
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "thinking...",
            providerOptions: {
              openai: {
                itemId: "rs_123",
                reasoningEncryptedContent: "encrypted",
              },
            },
          },
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_456",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, zenModel, { store: false }) as any[]

    expect(result).toHaveLength(1)
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("rs_123")
    expect(result[0].content[1].providerOptions?.openai?.itemId).toBe("msg_456")
  })

  test("preserves other openai options including itemId", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
                otherOption: "value",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, openaiModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
    expect(result[0].content[0].providerOptions?.openai?.otherOption).toBe("value")
  })

  test("preserves metadata for openai package when store is true", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    // openai package preserves itemId regardless of store value
    const result = ProviderTransform.message(msgs, openaiModel, { store: true }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })

  test("preserves metadata for non-openai packages when store is false", () => {
    const anthropicModel = {
      ...openaiModel,
      providerID: "anthropic",
      api: {
        id: "claude-3",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    // store=false preserves metadata for non-openai packages
    const result = ProviderTransform.message(msgs, anthropicModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })

  test("preserves metadata using providerID key when store is false", () => {
    const opencodeModel = {
      ...openaiModel,
      providerID: "opencode",
      api: {
        id: "opencode-test",
        url: "https://api.opencode.ai",
        npm: "@ai-sdk/openai-compatible",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              opencode: {
                itemId: "msg_123",
                otherOption: "value",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, opencodeModel, { store: false }) as any[]

    expect(result[0].content[0].providerOptions?.opencode?.itemId).toBe("msg_123")
    expect(result[0].content[0].providerOptions?.opencode?.otherOption).toBe("value")
  })

  test("preserves itemId across all providerOptions keys", () => {
    const opencodeModel = {
      ...openaiModel,
      providerID: "opencode",
      api: {
        id: "opencode-test",
        url: "https://api.opencode.ai",
        npm: "@ai-sdk/openai-compatible",
      },
    }
    const msgs = [
      {
        role: "assistant",
        providerOptions: {
          openai: { itemId: "msg_root" },
          opencode: { itemId: "msg_opencode" },
          extra: { itemId: "msg_extra" },
        },
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: { itemId: "msg_openai_part" },
              opencode: { itemId: "msg_opencode_part" },
              extra: { itemId: "msg_extra_part" },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, opencodeModel, { store: false }) as any[]

    expect(result[0].providerOptions?.openai?.itemId).toBe("msg_root")
    expect(result[0].providerOptions?.opencode?.itemId).toBe("msg_opencode")
    expect(result[0].providerOptions?.extra?.itemId).toBe("msg_extra")
    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_openai_part")
    expect(result[0].content[0].providerOptions?.opencode?.itemId).toBe("msg_opencode_part")
    expect(result[0].content[0].providerOptions?.extra?.itemId).toBe("msg_extra_part")
  })

  test("does not strip metadata for non-openai packages when store is not false", () => {
    const anthropicModel = {
      ...openaiModel,
      providerID: "anthropic",
      api: {
        id: "claude-3",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    }
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Hello",
            providerOptions: {
              openai: {
                itemId: "msg_123",
              },
            },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, anthropicModel, {}) as any[]

    expect(result[0].content[0].providerOptions?.openai?.itemId).toBe("msg_123")
  })
})

describe("ProviderTransform.message - providerOptions key remapping", () => {
  const createModel = (providerID: string, npm: string) =>
    ({
      id: `${providerID}/test-model`,
      providerID,
      api: {
        id: "test-model",
        url: "https://api.test.com",
        npm,
      },
      name: "Test Model",
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: false,
      },
      cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
      limit: { context: 128000, output: 8192 },
      status: "active",
      options: {},
      headers: {},
    }) as any

  test("azure keeps 'azure' key and does not remap to 'openai'", () => {
    const model = createModel("azure", "@ai-sdk/azure")
    const msgs = [
      {
        role: "user",
        content: "Hello",
        providerOptions: {
          azure: { someOption: "value" },
        },
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result[0].providerOptions?.azure).toEqual({ someOption: "value" })
    expect(result[0].providerOptions?.openai).toBeUndefined()
  })

  test("copilot remaps providerID to 'copilot' key", () => {
    const model = createModel("github-copilot", "@ai-sdk/github-copilot")
    const msgs = [
      {
        role: "user",
        content: "Hello",
        providerOptions: {
          copilot: { someOption: "value" },
        },
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result[0].providerOptions?.copilot).toEqual({ someOption: "value" })
    expect(result[0].providerOptions?.["github-copilot"]).toBeUndefined()
  })

  test("bedrock remaps providerID to 'bedrock' key", () => {
    const model = createModel("my-bedrock", "@ai-sdk/amazon-bedrock")
    const msgs = [
      {
        role: "user",
        content: "Hello",
        providerOptions: {
          "my-bedrock": { someOption: "value" },
        },
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result[0].providerOptions?.bedrock).toEqual({ someOption: "value" })
    expect(result[0].providerOptions?.["my-bedrock"]).toBeUndefined()
  })
})

describe("ProviderTransform.message - claude w/bedrock custom inference profile", () => {
  test("adds cachePoint", () => {
    const model = {
      id: "amazon-bedrock/custom-claude-sonnet-4.5",
      providerID: "amazon-bedrock",
      api: {
        id: "arn:aws:bedrock:xxx:yyy:application-inference-profile/zzz",
        url: "https://api.test.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
      name: "Custom inference profile",
      capabilities: {},
      options: {},
      headers: {},
    } as any

    const msgs = [
      {
        role: "user",
        content: "Hello",
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result[0].providerOptions?.bedrock).toEqual(
      expect.objectContaining({
        cachePoint: {
          type: "default",
        },
      }),
    )
  })
})

describe("ProviderTransform.message - cache control on gateway", () => {
  const createModel = (overrides: Partial<any> = {}) =>
    ({
      id: "anthropic/claude-sonnet-4",
      providerID: "vercel",
      api: {
        id: "anthropic/claude-sonnet-4",
        url: "https://ai-gateway.vercel.sh/v3/ai",
        npm: "@ai-sdk/gateway",
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
      cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
      limit: { context: 200_000, output: 8192 },
      status: "active",
      options: {},
      headers: {},
      ...overrides,
    }) as any

  test("gateway does not set cache control for anthropic models", () => {
    const model = createModel()
    const msgs = [
      {
        role: "system",
        content: [{ type: "text", text: "You are a helpful assistant" }],
      },
      {
        role: "user",
        content: "Hello",
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].content[0].providerOptions).toBeUndefined()
    expect(result[0].providerOptions).toBeUndefined()
  })

  test("non-gateway anthropic keeps existing cache control behavior", () => {
    const model = createModel({
      providerID: "anthropic",
      api: {
        id: "claude-sonnet-4",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    })
    const msgs = [
      {
        role: "system",
        content: "You are a helpful assistant",
      },
      {
        role: "user",
        content: "Hello",
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {}) as any[]

    expect(result[0].providerOptions).toEqual({
      anthropic: {
        cacheControl: {
          type: "ephemeral",
        },
      },
      openrouter: {
        cacheControl: {
          type: "ephemeral",
        },
      },
      bedrock: {
        cachePoint: {
          type: "default",
        },
      },
      openaiCompatible: {
        cache_control: {
          type: "ephemeral",
        },
      },
      copilot: {
        copilot_cache_control: {
          type: "ephemeral",
        },
      },
    })
  })
})

describe("ProviderTransform.variants", () => {
  const createMockModel = (overrides: Partial<any> = {}): any => ({
    id: "test/test-model",
    providerID: "test",
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.001,
      output: 0.002,
      cache: { read: 0.0001, write: 0.0002 },
    },
    limit: {
      context: 200_000,
      output: 64_000,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
    ...overrides,
  })

  test("returns empty object when model has no reasoning capabilities", () => {
    const model = createMockModel({
      capabilities: { reasoning: false },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("deepseek returns empty object", () => {
    const model = createMockModel({
      id: "deepseek/deepseek-chat",
      providerID: "deepseek",
      api: {
        id: "deepseek-chat",
        url: "https://api.deepseek.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("minimax returns empty object", () => {
    const model = createMockModel({
      id: "minimax/minimax-model",
      providerID: "minimax",
      api: {
        id: "minimax-model",
        url: "https://api.minimax.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("glm returns empty object", () => {
    const model = createMockModel({
      id: "glm/glm-4",
      providerID: "glm",
      api: {
        id: "glm-4",
        url: "https://api.glm.com",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  test("mistral returns empty object", () => {
    const model = createMockModel({
      id: "mistral/mistral-large",
      providerID: "mistral",
      api: {
        id: "mistral-large-latest",
        url: "https://api.mistral.com",
        npm: "@ai-sdk/mistral",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(result).toEqual({})
  })

  describe("@openrouter/ai-sdk-provider", () => {
    test("returns empty object for non-qualifying models", () => {
      const model = createMockModel({
        id: "openrouter/test-model",
        providerID: "openrouter",
        api: {
          id: "test-model",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("gpt models return OPENAI_EFFORTS with reasoning", () => {
      const model = createMockModel({
        id: "openrouter/gpt-4",
        providerID: "openrouter",
        api: {
          id: "gpt-4",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
      expect(result.low).toEqual({ reasoning: { effort: "low" } })
      expect(result.high).toEqual({ reasoning: { effort: "high" } })
    })

    test("gemini-3 returns OPENAI_EFFORTS with reasoning", () => {
      const model = createMockModel({
        id: "openrouter/gemini-3-5-pro",
        providerID: "openrouter",
        api: {
          id: "gemini-3-5-pro",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
    })

    test("grok-4 returns empty object", () => {
      const model = createMockModel({
        id: "openrouter/grok-4",
        providerID: "openrouter",
        api: {
          id: "grok-4",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("grok-3-mini returns low and high with reasoning", () => {
      const model = createMockModel({
        id: "openrouter/grok-3-mini",
        providerID: "openrouter",
        api: {
          id: "grok-3-mini",
          url: "https://openrouter.ai",
          npm: "@openrouter/ai-sdk-provider",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
      expect(result.low).toEqual({ reasoning: { effort: "low" } })
      expect(result.high).toEqual({ reasoning: { effort: "high" } })
    })
  })

  describe("@ai-sdk/gateway", () => {
    test("anthropic sonnet 4.6 models return adaptive thinking options", () => {
      const model = createMockModel({
        id: "anthropic/claude-sonnet-4-6",
        providerID: "gateway",
        api: {
          id: "anthropic/claude-sonnet-4-6",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.medium).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "medium",
      })
    })

    test("anthropic sonnet 4.6 dot-format models return adaptive thinking options", () => {
      const model = createMockModel({
        id: "anthropic/claude-sonnet-4-6",
        providerID: "gateway",
        api: {
          id: "anthropic/claude-sonnet-4.6",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.medium).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "medium",
      })
    })

    test("anthropic opus 4.6 dot-format models return adaptive thinking options", () => {
      const model = createMockModel({
        id: "anthropic/claude-opus-4-6",
        providerID: "gateway",
        api: {
          id: "anthropic/claude-opus-4.6",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.high).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "high",
      })
    })

    test("anthropic models return anthropic thinking options", () => {
      const model = createMockModel({
        id: "anthropic/claude-sonnet-4",
        providerID: "gateway",
        api: {
          id: "anthropic/claude-sonnet-4",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
      expect(result.high).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 16000,
        },
      })
      expect(result.max).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 31999,
        },
      })
    })

    test("returns OPENAI_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "gateway/gateway-model",
        providerID: "gateway",
        api: {
          id: "gateway-model",
          url: "https://gateway.ai",
          npm: "@ai-sdk/gateway",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/github-copilot", () => {
    test("standard models return low, medium, high", () => {
      const model = createMockModel({
        id: "gpt-4.5",
        providerID: "github-copilot",
        api: {
          id: "gpt-4.5",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("gpt-5.1-codex-max includes xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.1-codex-max",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.1-codex-max",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
    })

    test("gpt-5.1-codex-mini does not include xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.1-codex-mini",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.1-codex-mini",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    })

    test("gpt-5.1-codex does not include xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.1-codex",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.1-codex",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    })

    test("gpt-5.2 includes xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.2",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.2",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
      expect(result.xhigh).toEqual({
        reasoningEffort: "xhigh",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("gpt-5.2-codex includes xhigh", () => {
      const model = createMockModel({
        id: "gpt-5.2-codex",
        providerID: "github-copilot",
        api: {
          id: "gpt-5.2-codex",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh"])
    })
  })

  describe("@ai-sdk/cerebras", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "cerebras/llama-4",
        providerID: "cerebras",
        api: {
          id: "llama-4-sc",
          url: "https://api.cerebras.ai",
          npm: "@ai-sdk/cerebras",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/togetherai", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "togetherai/llama-4",
        providerID: "togetherai",
        api: {
          id: "llama-4-sc",
          url: "https://api.togetherai.com",
          npm: "@ai-sdk/togetherai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/xai", () => {
    test("grok-3 returns empty object", () => {
      const model = createMockModel({
        id: "xai/grok-3",
        providerID: "xai",
        api: {
          id: "grok-3",
          url: "https://api.x.ai",
          npm: "@ai-sdk/xai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("grok-3-mini returns low and high with reasoningEffort", () => {
      const model = createMockModel({
        id: "xai/grok-3-mini",
        providerID: "xai",
        api: {
          id: "grok-3-mini",
          url: "https://api.x.ai",
          npm: "@ai-sdk/xai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/deepinfra", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "deepinfra/llama-4",
        providerID: "deepinfra",
        api: {
          id: "llama-4-sc",
          url: "https://api.deepinfra.com",
          npm: "@ai-sdk/deepinfra",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/openai-compatible", () => {
    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningEffort", () => {
      const model = createMockModel({
        id: "custom-provider/custom-model",
        providerID: "custom-provider",
        api: {
          id: "custom-model",
          url: "https://api.custom.com",
          npm: "@ai-sdk/openai-compatible",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({ reasoningEffort: "low" })
      expect(result.high).toEqual({ reasoningEffort: "high" })
    })
  })

  describe("@ai-sdk/azure", () => {
    test("o1-mini returns empty object", () => {
      const model = createMockModel({
        id: "o1-mini",
        providerID: "azure",
        api: {
          id: "o1-mini",
          url: "https://azure.com",
          npm: "@ai-sdk/azure",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("standard azure models return custom efforts with reasoningSummary", () => {
      const model = createMockModel({
        id: "o1",
        providerID: "azure",
        api: {
          id: "o1",
          url: "https://azure.com",
          npm: "@ai-sdk/azure",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("gpt-5 adds minimal effort", () => {
      const model = createMockModel({
        id: "gpt-5",
        providerID: "azure",
        api: {
          id: "gpt-5",
          url: "https://azure.com",
          npm: "@ai-sdk/azure",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["minimal", "low", "medium", "high"])
    })
  })

  describe("@ai-sdk/openai", () => {
    test("gpt-5-pro returns empty object", () => {
      const model = createMockModel({
        id: "gpt-5-pro",
        providerID: "openai",
        api: {
          id: "gpt-5-pro",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })

    test("standard openai models return custom efforts with reasoningSummary", () => {
      const model = createMockModel({
        id: "gpt-5",
        providerID: "openai",
        api: {
          id: "gpt-5",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2024-06-01",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["minimal", "low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      })
    })

    test("models after 2025-11-13 include 'none' effort", () => {
      const model = createMockModel({
        id: "gpt-5-nano",
        providerID: "openai",
        api: {
          id: "gpt-5-nano",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2025-11-14",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high"])
    })

    test("models after 2025-12-04 include 'xhigh' effort", () => {
      const model = createMockModel({
        id: "openai/gpt-5-chat",
        providerID: "openai",
        api: {
          id: "gpt-5-chat",
          url: "https://api.openai.com",
          npm: "@ai-sdk/openai",
        },
        release_date: "2025-12-05",
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"])
    })
  })

  describe("@ai-sdk/anthropic", () => {
    test("sonnet 4.6 returns adaptive thinking options", () => {
      const model = createMockModel({
        id: "anthropic/claude-sonnet-4-6",
        providerID: "anthropic",
        api: {
          id: "claude-sonnet-4-6",
          url: "https://api.anthropic.com",
          npm: "@ai-sdk/anthropic",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.high).toEqual({
        thinking: {
          type: "adaptive",
        },
        effort: "high",
      })
    })

    test("returns high and max with thinking config", () => {
      const model = createMockModel({
        id: "anthropic/claude-4",
        providerID: "anthropic",
        api: {
          id: "claude-4",
          url: "https://api.anthropic.com",
          npm: "@ai-sdk/anthropic",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
      expect(result.high).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 16000,
        },
      })
      expect(result.max).toEqual({
        thinking: {
          type: "enabled",
          budgetTokens: 31999,
        },
      })
    })
  })

  describe("@ai-sdk/amazon-bedrock", () => {
    test("anthropic sonnet 4.6 returns adaptive reasoning options", () => {
      const model = createMockModel({
        id: "bedrock/anthropic-claude-sonnet-4-6",
        providerID: "bedrock",
        api: {
          id: "anthropic.claude-sonnet-4-6",
          url: "https://bedrock.amazonaws.com",
          npm: "@ai-sdk/amazon-bedrock",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
      expect(result.max).toEqual({
        reasoningConfig: {
          type: "adaptive",
          maxReasoningEffort: "max",
        },
      })
    })

    test("returns WIDELY_SUPPORTED_EFFORTS with reasoningConfig", () => {
      const model = createMockModel({
        id: "bedrock/llama-4",
        providerID: "bedrock",
        api: {
          id: "llama-4-sc",
          url: "https://bedrock.amazonaws.com",
          npm: "@ai-sdk/amazon-bedrock",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
      expect(result.low).toEqual({
        reasoningConfig: {
          type: "enabled",
          maxReasoningEffort: "low",
        },
      })
    })
  })

  describe("@ai-sdk/google", () => {
    test("gemini-2.5 returns high and max with thinkingConfig and thinkingBudget", () => {
      const model = createMockModel({
        id: "google/gemini-2.5-pro",
        providerID: "google",
        api: {
          id: "gemini-2.5-pro",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
      expect(result.high).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 16000,
        },
      })
      expect(result.max).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 24576,
        },
      })
    })

    test("other gemini models return low and high with thinkingLevel", () => {
      const model = createMockModel({
        id: "google/gemini-2.0-pro",
        providerID: "google",
        api: {
          id: "gemini-2.0-pro",
          url: "https://generativelanguage.googleapis.com",
          npm: "@ai-sdk/google",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
      expect(result.low).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: "low",
        },
      })
      expect(result.high).toEqual({
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: "high",
        },
      })
    })
  })

  describe("@ai-sdk/google-vertex", () => {
    test("gemini-2.5 returns high and max with thinkingConfig and thinkingBudget", () => {
      const model = createMockModel({
        id: "google-vertex/gemini-2.5-pro",
        providerID: "google-vertex",
        api: {
          id: "gemini-2.5-pro",
          url: "https://vertexai.googleapis.com",
          npm: "@ai-sdk/google-vertex",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["high", "max"])
    })

    test("other vertex models return low and high with thinkingLevel", () => {
      const model = createMockModel({
        id: "google-vertex/gemini-2.0-pro",
        providerID: "google-vertex",
        api: {
          id: "gemini-2.0-pro",
          url: "https://vertexai.googleapis.com",
          npm: "@ai-sdk/google-vertex",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["low", "high"])
    })
  })

  describe("@ai-sdk/cohere", () => {
    test("returns empty object", () => {
      const model = createMockModel({
        id: "cohere/command-r",
        providerID: "cohere",
        api: {
          id: "command-r",
          url: "https://api.cohere.com",
          npm: "@ai-sdk/cohere",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })
  })

  describe("@ai-sdk/groq", () => {
    test("returns none and WIDELY_SUPPORTED_EFFORTS with thinkingLevel", () => {
      const model = createMockModel({
        id: "groq/llama-4",
        providerID: "groq",
        api: {
          id: "llama-4-sc",
          url: "https://api.groq.com",
          npm: "@ai-sdk/groq",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(Object.keys(result)).toEqual(["none", "low", "medium", "high"])
      expect(result.none).toEqual({
        reasoningEffort: "none",
      })
      expect(result.low).toEqual({
        reasoningEffort: "low",
      })
    })
  })

  describe("@ai-sdk/perplexity", () => {
    test("returns empty object", () => {
      const model = createMockModel({
        id: "perplexity/sonar-plus",
        providerID: "perplexity",
        api: {
          id: "sonar-plus",
          url: "https://api.perplexity.ai",
          npm: "@ai-sdk/perplexity",
        },
      })
      const result = ProviderTransform.variants(model)
      expect(result).toEqual({})
    })
  })
})

describe("ProviderTransform.message - Databricks prompt caching", () => {
  const databricksGptModel = {
    id: "databricks-gpt-5",
    providerID: "databricks",
    api: {
      id: "databricks-gpt-5",
      url: "https://my-workspace.cloud.databricks.com/serving-endpoints",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "GPT-5 (Databricks)",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 1.25,
      output: 10,
      cache: { read: 0.125, write: 0 },
    },
    limit: {
      context: 400000,
      output: 128000,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  const databricksClaudeModel = {
    id: "databricks-claude-sonnet-4",
    providerID: "databricks",
    api: {
      id: "databricks-claude-sonnet-4",
      url: "https://my-workspace.cloud.databricks.com/serving-endpoints",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Claude Sonnet 4 (Databricks)",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 3,
      output: 15,
      cache: { read: 0.3, write: 0 },
    },
    limit: {
      context: 200000,
      output: 64000,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  const databricksNoCacheModel = {
    id: "databricks-no-cache-model",
    providerID: "databricks",
    api: {
      id: "databricks-no-cache-model",
      url: "https://my-workspace.cloud.databricks.com/serving-endpoints",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "No Cache Model (Databricks)",
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
      input: 1,
      output: 2,
      cache: { read: 0, write: 0 }, // No cache support
    },
    limit: {
      context: 100000,
      output: 10000,
    },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("applies cache_control to system messages for Databricks GPT model", () => {
    const msgs = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ] as any[]

    const result = ProviderTransform.message(msgs, databricksGptModel, {}) as any[]

    // System message should have cache control
    const systemMsg = result.find((m) => m.role === "system")
    expect(systemMsg).toBeDefined()
    expect(systemMsg!.providerOptions).toBeDefined()
    expect(systemMsg!.providerOptions.openaiCompatible).toEqual({ cache_control: { type: "ephemeral" } })
  })

  test("applies cache_control to system messages for Databricks Claude model", () => {
    const msgs = [
      { role: "system", content: "You are a coding assistant." },
      { role: "user", content: "Write code" },
    ] as any[]

    const result = ProviderTransform.message(msgs, databricksClaudeModel, {}) as any[]

    const systemMsg = result.find((m) => m.role === "system")
    expect(systemMsg).toBeDefined()
    expect(systemMsg!.providerOptions).toBeDefined()
    expect(systemMsg!.providerOptions.openaiCompatible).toEqual({ cache_control: { type: "ephemeral" } })
  })

  test("applies cache_control to last messages in conversation", () => {
    const msgs = [
      { role: "system", content: "System prompt" },
      { role: "user", content: "First message" },
      { role: "assistant", content: "First response" },
      { role: "user", content: "Second message" },
      { role: "assistant", content: "Second response" },
      { role: "user", content: "Third message" },
    ] as any[]

    const result = ProviderTransform.message(msgs, databricksGptModel, {}) as any[]

    // Last 2 non-system messages should have cache control
    const lastTwo = result.filter((m) => m.role !== "system").slice(-2)
    expect(lastTwo).toHaveLength(2)

    for (const msg of lastTwo) {
      expect(msg.providerOptions).toBeDefined()
      expect(msg.providerOptions!.openaiCompatible).toEqual({ cache_control: { type: "ephemeral" } })
    }
  })

  test("does not apply caching for Databricks model without cache cost", () => {
    const msgs = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ] as any[]

    const result = ProviderTransform.message(msgs, databricksNoCacheModel, {}) as any[]

    // No cache control should be applied when cache.read is 0
    const systemMsg = result.find((m) => m.role === "system")
    expect(systemMsg).toBeDefined()
    expect(systemMsg!.providerOptions?.openaiCompatible?.cache_control).toBeUndefined()
  })

  test("applies cache_control to array content for Databricks models", () => {
    const msgs = [
      { role: "system", content: "System prompt" },
      {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "text", text: "World" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, databricksGptModel, {}) as any[]

    // User message with array content should have cache control on last content part
    const userMsg = result.find((m) => m.role === "user")
    expect(userMsg).toBeDefined()
    expect(userMsg!.content).toHaveLength(2)

    // Last content part should have providerOptions with cache_control
    const lastPart = userMsg!.content[userMsg!.content.length - 1]
    expect(lastPart.providerOptions).toBeDefined()
    expect(lastPart.providerOptions.openaiCompatible).toEqual({ cache_control: { type: "ephemeral" } })
  })

  test("caching is applied to first 2 system messages", () => {
    const msgs = [
      { role: "system", content: "First system message" },
      { role: "system", content: "Second system message" },
      { role: "system", content: "Third system message" },
      { role: "user", content: "Hello" },
    ] as any[]

    const result = ProviderTransform.message(msgs, databricksGptModel, {}) as any[]

    const systemMsgs = result.filter((m) => m.role === "system")

    // First two system messages should have cache control
    expect(systemMsgs[0].providerOptions?.openaiCompatible).toEqual({ cache_control: { type: "ephemeral" } })
    expect(systemMsgs[1].providerOptions?.openaiCompatible).toEqual({ cache_control: { type: "ephemeral" } })

    // Third system message should NOT have cache control
    expect(systemMsgs[2].providerOptions?.openaiCompatible?.cache_control).toBeUndefined()
  })
})

describe("ProviderTransform.schema - Databricks Gemini $schema stripping", () => {
  const databricksGeminiModel = {
    id: "databricks-gemini-3-pro",
    providerID: "databricks",
    api: {
      id: "databricks-gemini-3-pro",
      url: "https://workspace.cloud.databricks.com/serving-endpoints",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Gemini 3 Pro (Databricks)",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: true, image: true, video: true, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 2,
      output: 12,
      cache: { read: 0.2, write: 0 },
    },
    limit: {
      context: 1000000,
      output: 65536,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-11-20",
  } as any

  const databricksGptModel2 = {
    id: "databricks-gpt-5",
    providerID: "databricks",
    api: {
      id: "databricks-gpt-5",
      url: "https://workspace.cloud.databricks.com/serving-endpoints",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "GPT-5 (Databricks)",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 1.25,
      output: 10,
      cache: { read: 0.125, write: 0 },
    },
    limit: {
      context: 400000,
      output: 128000,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-06-12",
  } as any

  test("strips $schema field from Databricks Gemini tool schemas", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        name: { type: "string" },
      },
    } as any

    const result = ProviderTransform.schema(databricksGeminiModel, schema) as any

    expect(result.$schema).toBeUndefined()
    expect(result.type).toBe("object")
    expect(result.properties.name.type).toBe("string")
  })

  test("strips $defs and definitions from Databricks Gemini tool schemas", () => {
    const schema = {
      type: "object",
      $defs: {
        MyType: { type: "string" },
      },
      definitions: {
        AnotherType: { type: "number" },
      },
      properties: {
        name: { type: "string" },
      },
    } as any

    const result = ProviderTransform.schema(databricksGeminiModel, schema) as any

    expect(result.$defs).toBeUndefined()
    expect(result.definitions).toBeUndefined()
    expect(result.properties.name.type).toBe("string")
  })

  test("resolves $ref references inline for Databricks Gemini", () => {
    const schema = {
      type: "object",
      $defs: {
        Address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
          },
        },
      },
      properties: {
        homeAddress: { $ref: "#/$defs/Address" },
        workAddress: { $ref: "#/$defs/Address" },
      },
    } as any

    const result = ProviderTransform.schema(databricksGeminiModel, schema) as any

    // $defs should be stripped
    expect(result.$defs).toBeUndefined()

    // $ref should be resolved inline
    expect(result.properties.homeAddress.type).toBe("object")
    expect(result.properties.homeAddress.properties.street.type).toBe("string")
    expect(result.properties.homeAddress.$ref).toBeUndefined()

    expect(result.properties.workAddress.type).toBe("object")
    expect(result.properties.workAddress.properties.city.type).toBe("string")
  })

  test("resolves nested $ref references", () => {
    const schema = {
      type: "object",
      $defs: {
        Person: {
          type: "object",
          properties: {
            name: { type: "string" },
            address: { $ref: "#/$defs/Address" },
          },
        },
        Address: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
        },
      },
      properties: {
        person: { $ref: "#/$defs/Person" },
      },
    } as any

    const result = ProviderTransform.schema(databricksGeminiModel, schema) as any

    expect(result.properties.person.type).toBe("object")
    expect(result.properties.person.properties.name.type).toBe("string")
    expect(result.properties.person.properties.address.type).toBe("object")
    expect(result.properties.person.properties.address.properties.city.type).toBe("string")
  })

  test("does NOT strip $schema for non-Gemini Databricks models", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        name: { type: "string" },
      },
    } as any

    const result = ProviderTransform.schema(databricksGptModel2, schema) as any

    // GPT models keep $schema (they handle it fine)
    expect(result.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
  })

  test("handles schemas with both $schema and $ref", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      $defs: {
        Item: { type: "string" },
      },
      properties: {
        items: {
          type: "array",
          items: { $ref: "#/$defs/Item" },
        },
      },
    } as any

    const result = ProviderTransform.schema(databricksGeminiModel, schema) as any

    expect(result.$schema).toBeUndefined()
    expect(result.$defs).toBeUndefined()
    expect(result.properties.items.type).toBe("array")
    expect(result.properties.items.items.type).toBe("string")
  })

  test("preserves other schema fields while stripping $schema", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      title: "MyTool",
      description: "A useful tool",
      required: ["name"],
      properties: {
        name: { type: "string", description: "The name" },
      },
    } as any

    const result = ProviderTransform.schema(databricksGeminiModel, schema) as any

    expect(result.$schema).toBeUndefined()
    expect(result.title).toBe("MyTool")
    expect(result.description).toBe("A useful tool")
    expect(result.required).toEqual(["name"])
    expect(result.properties.name.description).toBe("The name")
  })
})

describe("ProviderTransform.schema - Databricks Gemini advanced $ref and $schema handling", () => {
  const databricksGeminiModel = {
    id: "databricks-gemini-3-pro",
    providerID: "databricks",
    api: {
      id: "databricks-gemini-3-pro",
      url: "https://workspace.cloud.databricks.com/serving-endpoints",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Gemini 3 Pro (Databricks)",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: true, image: true, video: true, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 2, output: 12, cache: { read: 0.2, write: 0 } },
    limit: { context: 1000000, output: 65536 },
    status: "active",
    options: {},
    headers: {},
  } as any

  const openaiModel = {
    id: "gpt-5",
    providerID: "openai",
    api: {
      id: "gpt-5",
      url: "https://api.openai.com",
      npm: "@ai-sdk/openai",
    },
    name: "GPT-5",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1.25, output: 10, cache: { read: 0.125, write: 0 } },
    limit: { context: 400000, output: 128000 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("strips $schema from MCP tool schemas with deeply nested properties", () => {
    // MCP tools include $schema at root - Gemini rejects this
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        query: { type: "string" },
        options: {
          type: "object",
          properties: {
            nested: {
              type: "object",
              $schema: "https://json-schema.org/draft/2020-12/schema",
              properties: {
                deep: { type: "string" },
              },
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(databricksGeminiModel, schema) as any

    expect(result.$schema).toBeUndefined()
    // Nested $schema should also be stripped
    expect(result.properties.options.properties.nested.$schema).toBeUndefined()
    expect(result.properties.options.properties.nested.type).toBe("object")
    expect(result.properties.options.properties.nested.properties.deep.type).toBe("string")
  })

  test("handles circular $ref without infinite loop", () => {
    // TreeNode references itself - must not infinite loop
    const schema = {
      type: "object",
      $defs: {
        TreeNode: {
          type: "object",
          properties: {
            value: { type: "string" },
            children: {
              type: "array",
              items: { $ref: "#/$defs/TreeNode" },
            },
          },
        },
      },
      properties: {
        root: { $ref: "#/$defs/TreeNode" },
      },
    } as any

    // Should not hang - must complete within reasonable time
    const result = ProviderTransform.schema(databricksGeminiModel, schema) as any

    // Root should be resolved
    expect(result.properties.root.type).toBe("object")
    expect(result.properties.root.properties.value.type).toBe("string")
    // Circular ref should be replaced with {type: "object"} fallback
    expect(result.properties.root.properties.children.type).toBe("array")
    expect(result.properties.root.properties.children.items).toBeDefined()
    // Should not have $ref remaining
    expect(result.properties.root.properties.children.items.$ref).toBeUndefined()
  })

  test("expands $ref with definitions (legacy format)", () => {
    const schema = {
      type: "object",
      definitions: {
        Color: {
          type: "string",
          enum: ["red", "green", "blue"],
        },
      },
      properties: {
        favoriteColor: { $ref: "#/definitions/Color" },
      },
    } as any

    const result = ProviderTransform.schema(databricksGeminiModel, schema) as any

    expect(result.definitions).toBeUndefined()
    expect(result.properties.favoriteColor.type).toBe("string")
    expect(result.properties.favoriteColor.enum).toEqual(["red", "green", "blue"])
    expect(result.properties.favoriteColor.$ref).toBeUndefined()
  })

  test("preserves description alongside $ref", () => {
    const schema = {
      type: "object",
      $defs: {
        Address: {
          type: "object",
          properties: {
            street: { type: "string" },
          },
        },
      },
      properties: {
        home: {
          $ref: "#/$defs/Address",
          description: "Home address override",
        },
      },
    } as any

    const result = ProviderTransform.schema(databricksGeminiModel, schema) as any

    // The resolved ref should be inlined
    expect(result.properties.home.type).toBe("object")
    expect(result.properties.home.properties.street.type).toBe("string")
    expect(result.properties.home.$ref).toBeUndefined()
    // The local description should be preserved (overrides resolved ref)
    expect(result.properties.home.description).toBe("Home address override")
  })

  test("does not expand $ref for non-Databricks providers", () => {
    const schema = {
      type: "object",
      $defs: {
        Item: { type: "string" },
      },
      properties: {
        name: { $ref: "#/$defs/Item" },
      },
    } as any

    const result = ProviderTransform.schema(openaiModel, schema) as any

    // OpenAI provider should keep $ref as-is
    expect(result.properties.name.$ref).toBe("#/$defs/Item")
    expect(result.$defs).toBeDefined()
  })

  test("expands $ref in array items", () => {
    const schema = {
      type: "object",
      $defs: {
        QuestionOption: {
          type: "object",
          properties: {
            label: { type: "string" },
            description: { type: "string" },
          },
          required: ["label", "description"],
        },
      },
      properties: {
        options: {
          type: "array",
          items: { $ref: "#/$defs/QuestionOption" },
        },
      },
    } as any

    const result = ProviderTransform.schema(databricksGeminiModel, schema) as any

    expect(result.$defs).toBeUndefined()
    expect(result.properties.options.type).toBe("array")
    expect(result.properties.options.items.type).toBe("object")
    expect(result.properties.options.items.properties.label.type).toBe("string")
    expect(result.properties.options.items.$ref).toBeUndefined()
  })
})

describe("ProviderTransform.schema - MCP tool schema sanitization flow", () => {
  // These tests simulate the exact flow that prompt.ts should use:
  // 1. Extract raw JSON schema from MCP tool (via inputSchema.jsonSchema)
  // 2. Pass through ProviderTransform.schema(model, rawSchema)
  // 3. Result should be safe for the target provider's API

  const databricksGeminiModel = {
    id: "databricks-gemini-3-pro",
    providerID: "databricks",
    api: {
      id: "databricks-gemini-3-pro",
      url: "https://workspace.cloud.databricks.com/serving-endpoints",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Gemini 3 Pro (Databricks)",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: true, image: true, video: true, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 2, output: 12, cache: { read: 0.2, write: 0 } },
    limit: { context: 1000000, output: 65536 },
    status: "active",
    options: {},
    headers: {},
  } as any

  const openaiModel = {
    id: "gpt-5",
    providerID: "openai",
    api: {
      id: "gpt-5",
      url: "https://api.openai.com",
      npm: "@ai-sdk/openai",
    },
    name: "GPT-5",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1.25, output: 10, cache: { read: 0.125, write: 0 } },
    limit: { context: 400000, output: 128000 },
    status: "active",
    options: {},
    headers: {},
  } as any

  const databricksNonGeminiModel = {
    id: "databricks-dbrx-instruct",
    providerID: "databricks",
    api: {
      id: "databricks-dbrx-instruct",
      url: "https://workspace.cloud.databricks.com/serving-endpoints",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "DBRX Instruct (Databricks)",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.75, output: 2.25, cache: { read: 0, write: 0 } },
    limit: { context: 32768, output: 4096 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("MCP-style schema with $schema + $ref + $defs fully sanitized for Databricks Gemini", () => {
    // Realistic MCP tool schema - has $schema (from JSON Schema spec), $defs with $ref
    const mcpSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      $defs: {
        Option: {
          type: "object",
          properties: {
            label: { type: "string" },
            description: { type: "string" },
          },
          required: ["label"],
        },
      },
      properties: {
        query: { type: "string", description: "Search query" },
        options: {
          type: "array",
          items: { $ref: "#/$defs/Option" },
        },
      },
      required: ["query"],
      additionalProperties: false,
    } as any

    const result = ProviderTransform.schema(databricksGeminiModel, mcpSchema) as any

    // $schema must be stripped - Gemini API rejects it
    expect(result.$schema).toBeUndefined()
    // $defs must be stripped - Gemini API rejects it
    expect(result.$defs).toBeUndefined()
    // $ref must be resolved inline
    expect(result.properties.options.items.$ref).toBeUndefined()
    expect(result.properties.options.items.type).toBe("object")
    expect(result.properties.options.items.properties.label.type).toBe("string")
    // Other fields preserved
    expect(result.properties.query.type).toBe("string")
    expect(result.properties.query.description).toBe("Search query")
    expect(result.required).toEqual(["query"])
    expect(result.type).toBe("object")
  })

  test("MCP tool schemas are unchanged for non-Databricks providers", () => {
    const mcpSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      $defs: {
        Item: { type: "string" },
      },
      properties: {
        name: { $ref: "#/$defs/Item" },
      },
    } as any

    const result = ProviderTransform.schema(openaiModel, mcpSchema) as any

    // Non-Databricks providers should keep all fields as-is
    expect(result.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
    expect(result.$defs).toBeDefined()
    expect(result.properties.name.$ref).toBe("#/$defs/Item")
  })

  test("MCP tool execute function preserved after schema sanitization", () => {
    // Simulates the prompt.ts pattern: spread tool object with new inputSchema
    const executeResult = { content: [{ type: "text", text: "result" }] }
    const mockExecute = async () => executeResult

    // Simulate MCP tool object (like what MCP.tools() returns)
    const mcpTool = {
      description: "A test MCP tool",
      inputSchema: {
        jsonSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: { query: { type: "string" } },
        },
      },
      execute: mockExecute,
      type: "dynamic" as const,
    }

    // Apply the same pattern as the prompt.ts fix
    const rawSchema = (mcpTool.inputSchema as any)?.jsonSchema ?? {}
    const sanitizedSchema = ProviderTransform.schema(databricksGeminiModel, rawSchema)
    const sanitizedTool = {
      ...mcpTool,
      inputSchema: { jsonSchema: sanitizedSchema },
    }

    // Schema should be sanitized
    expect((sanitizedTool.inputSchema as any).jsonSchema.$schema).toBeUndefined()
    // Execute function should be preserved (same reference)
    expect(sanitizedTool.execute).toBe(mockExecute)
    // Description and type should be preserved
    expect(sanitizedTool.description).toBe("A test MCP tool")
    expect(sanitizedTool.type).toBe("dynamic")
  })

  test("MCP tool schemas get type:object but keep $schema for non-Gemini Databricks models", () => {
    const mcpSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      $defs: {
        Item: { type: "string" },
      },
      properties: {
        items: {
          type: "array",
          items: { $ref: "#/$defs/Item" },
        },
      },
    } as any

    const result = ProviderTransform.schema(databricksNonGeminiModel, mcpSchema) as any

    // Non-Gemini Databricks: type: "object" ensured but $schema/$ref/$defs preserved
    expect(result.type).toBe("object")
    expect(result.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
    expect(result.$defs).toBeDefined()
    expect(result.properties.items.items.$ref).toBe("#/$defs/Item")
  })
})

describe("ProviderTransform.schema - Databricks Gemini bare ref field stripping", () => {
  const databricksGeminiModel = {
    id: "databricks-gemini-2.0-flash",
    providerID: "databricks",
    api: {
      id: "databricks-gemini-2.0-flash",
      url: "https://workspace.cloud.databricks.com/serving-endpoints",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Gemini 2.0 Flash (Databricks)",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 1048576, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  const openaiModel = {
    id: "gpt-4o",
    providerID: "openai",
    api: {
      id: "gpt-4o",
      url: "https://api.openai.com/v1",
      npm: "@ai-sdk/openai",
    },
    name: "GPT-4o",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 2.5, output: 10, cache: { read: 1.25, write: 0 } },
    limit: { context: 128000, output: 16384 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("Databricks Gemini: strips bare ref field from Zod metadata", () => {
    // Zod's .meta({ ref: "QuestionOption" }) produces a bare "ref" field (no $ prefix)
    // Gemini interprets this as Schema.ref and rejects the schema
    const schema = {
      ref: "QuestionOption",
      type: "object",
      properties: {
        label: { type: "string" },
        description: { type: "string" },
      },
      required: ["label", "description"],
    } as any

    const result = ProviderTransform.schema(databricksGeminiModel, schema) as any

    // Bare "ref" must be stripped
    expect(result.ref).toBeUndefined()
    // All other fields must be preserved
    expect(result.type).toBe("object")
    expect(result.properties.label.type).toBe("string")
    expect(result.properties.description.type).toBe("string")
    expect(result.required).toEqual(["label", "description"])
  })

  test("Databricks Gemini: strips nested bare ref fields", () => {
    // Schema with bare "ref" at multiple nesting levels
    const schema = {
      ref: "Outer",
      type: "object",
      properties: {
        inner: {
          ref: "Inner",
          type: "object",
          properties: {
            value: { type: "string" },
          },
        },
        items: {
          type: "array",
          items: {
            ref: "ArrayItem",
            type: "string",
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(databricksGeminiModel, schema) as any

    // All bare "ref" fields must be stripped at every level
    expect(result.ref).toBeUndefined()
    expect(result.properties.inner.ref).toBeUndefined()
    expect(result.properties.items.items.ref).toBeUndefined()
    // Structure preserved
    expect(result.type).toBe("object")
    expect(result.properties.inner.type).toBe("object")
    expect(result.properties.inner.properties.value.type).toBe("string")
    expect(result.properties.items.type).toBe("array")
    expect(result.properties.items.items.type).toBe("string")
  })

  test("non-Databricks: preserves bare ref field", () => {
    // Non-Databricks providers should NOT strip bare ref
    const schema = {
      ref: "QuestionOption",
      type: "object",
      properties: {
        label: { type: "string" },
      },
      required: ["label"],
    } as any

    const result = ProviderTransform.schema(openaiModel, schema) as any

    // Bare "ref" should be preserved for non-Databricks providers
    expect(result.ref).toBe("QuestionOption")
    expect(result.type).toBe("object")
    expect(result.properties.label.type).toBe("string")
  })

  test("Databricks Gemini: realistic question tool schema sanitized", () => {
    // Full QuestionInfo-like schema matching what question/index.ts produces:
    // - $defs with QuestionOption that has ref: "QuestionOption" (Zod metadata)
    // - options array referencing QuestionOption via $ref
    // - Top-level ref: "QuestionInfo" (Zod metadata)
    const schema = {
      ref: "QuestionInfo",
      type: "object",
      $defs: {
        QuestionOption: {
          ref: "QuestionOption",
          type: "object",
          properties: {
            label: { type: "string", description: "Display text for this option" },
            description: { type: "string", description: "Explanation of this option" },
          },
          required: ["label", "description"],
        },
      },
      properties: {
        question: { type: "string", description: "The question to ask" },
        options: {
          type: "array",
          items: { $ref: "#/$defs/QuestionOption" },
          description: "Available choices",
        },
        multiSelect: { type: "boolean", description: "Allow multiple selections" },
      },
      required: ["question", "options"],
    } as any

    const result = ProviderTransform.schema(databricksGeminiModel, schema) as any

    // No bare "ref" fields anywhere
    expect(result.ref).toBeUndefined()
    // $defs must be removed (resolved inline)
    expect(result.$defs).toBeUndefined()
    // $ref must be resolved inline
    expect(result.properties.options.items.$ref).toBeUndefined()
    // QuestionOption resolved inline - with its bare "ref" stripped too
    expect(result.properties.options.items.ref).toBeUndefined()
    expect(result.properties.options.items.type).toBe("object")
    expect(result.properties.options.items.properties.label.type).toBe("string")
    expect(result.properties.options.items.properties.label.description).toBe("Display text for this option")
    expect(result.properties.options.items.properties.description.type).toBe("string")
    expect(result.properties.options.items.required).toEqual(["label", "description"])
    // Top-level structure preserved
    expect(result.type).toBe("object")
    expect(result.properties.question.type).toBe("string")
    expect(result.properties.multiSelect.type).toBe("boolean")
    expect(result.required).toEqual(["question", "options"])
  })
})
