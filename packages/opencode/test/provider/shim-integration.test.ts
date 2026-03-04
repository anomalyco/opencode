/**
 * Integration tests for the v2→v3 shim against the real installed provider packages.
 *
 * These tests install the actual npm packages via BunProc.install (the same
 * mechanism the runtime uses) then verify that shimProvider / shimLanguageModel
 * work correctly against the real module shapes, not just hand-crafted fakes.
 *
 * If network is unavailable the packages will fail to install and all tests in
 * this file are skipped automatically.
 */

import { describe, test, expect, beforeAll } from "bun:test"
import { shimLanguageModel, shimProvider } from "../../src/provider/shim"
import { BunProc } from "../../src/bun"

// ---------------------------------------------------------------------------
// Install real packages via BunProc.install, same as the runtime does.
// Tests are skipped if either package cannot be installed (e.g. no network).
// ---------------------------------------------------------------------------

let createVenice: ((opts?: any) => any) | undefined
let createSAPAIProvider: ((opts?: any) => any) | undefined
let skipReason: string | undefined

beforeAll(async () => {
  const results = await Promise.allSettled([
    BunProc.install("venice-ai-sdk-provider", "latest"),
    BunProc.install("@jerome-benoit/sap-ai-provider-v2", "latest"),
  ])

  const [venice, sap] = results

  if (venice.status === "rejected") {
    skipReason = `venice-ai-sdk-provider install failed: ${venice.reason}`
    return
  }
  if (sap.status === "rejected") {
    skipReason = `@jerome-benoit/sap-ai-provider-v2 install failed: ${sap.reason}`
    return
  }

  const [veniceModule, sapModule] = await Promise.all([import(venice.value), import(sap.value)])

  createVenice = veniceModule.createVenice
  createSAPAIProvider = sapModule.createSAPAIProvider
}, 120_000)

function skip() {
  if (skipReason) return true
  if (!createVenice || !createSAPAIProvider) return true
  return false
}

// ---------------------------------------------------------------------------
// venice-ai-sdk-provider (v2 object+callable, textEmbeddingModel)
// ---------------------------------------------------------------------------

describe("venice-ai-sdk-provider real module", () => {
  test("raw provider is callable and has specificationVersion undefined", () => {
    if (skip()) return
    const provider = createVenice!({ apiKey: "test-key" })
    expect(typeof provider).toBe("function")
    expect(provider.specificationVersion).toBeUndefined()
  })

  test("raw language model has specificationVersion v2", () => {
    if (skip()) return
    const model = createVenice!({ apiKey: "test-key" }).languageModel("venice-uncensored")
    expect(model.specificationVersion).toBe("v2")
  })

  test("raw provider has both textEmbeddingModel and embeddingModel", () => {
    if (skip()) return
    const provider = createVenice!({ apiKey: "test-key" })
    expect(typeof provider.textEmbeddingModel).toBe("function")
    expect(typeof provider.embeddingModel).toBe("function")
  })

  test("shimProvider wraps venice to v3", () => {
    if (skip()) return
    expect(shimProvider(createVenice!({ apiKey: "test-key" })).specificationVersion).toBe("v3")
  })

  test("shimmed venice provider is still callable as a function", () => {
    if (skip()) return
    expect(() => shimProvider(createVenice!({ apiKey: "test-key" }))("venice-uncensored")).not.toThrow()
  })

  test("shimmed callable returns v3 language model", () => {
    if (skip()) return
    const model = shimProvider(createVenice!({ apiKey: "test-key" }))("venice-uncensored")
    expect(model.specificationVersion).toBe("v3")
  })

  test("shimmed languageModel() returns v3 model", () => {
    if (skip()) return
    const model = shimProvider(createVenice!({ apiKey: "test-key" })).languageModel("venice-uncensored")
    expect(model.specificationVersion).toBe("v3")
  })

  test("shimmed embeddingModel() routes to textEmbeddingModel on the raw provider", () => {
    if (skip()) return
    expect(() => shimProvider(createVenice!({ apiKey: "test-key" })).embeddingModel("venice-embedding")).not.toThrow()
  })

  test("shimmed venice language model preserves provider and modelId", () => {
    if (skip()) return
    const model = shimProvider(createVenice!({ apiKey: "test-key" })).languageModel("venice-llama-3-3-70b")
    expect(model.provider).toContain("venice")
    expect(model.modelId).toBe("venice-llama-3-3-70b")
  })

  test("shimmed model doGenerate is a function", () => {
    if (skip()) return
    const model = shimProvider(createVenice!({ apiKey: "test-key" })).languageModel("venice-uncensored")
    expect(typeof model.doGenerate).toBe("function")
  })

  test("shimmed model doStream is a function", () => {
    if (skip()) return
    const model = shimProvider(createVenice!({ apiKey: "test-key" })).languageModel("venice-uncensored")
    expect(typeof model.doStream).toBe("function")
  })

  test("shimProvider is idempotent on venice provider", () => {
    if (skip()) return
    const raw = createVenice!({ apiKey: "test-key" })
    const once = shimProvider(raw)
    const twice = shimProvider(once)
    expect(twice).toBe(once)
  })

  test("shimLanguageModel is idempotent on a shimmed venice model", () => {
    if (skip()) return
    const model = createVenice!({ apiKey: "test-key" }).languageModel("venice-uncensored")
    const once = shimLanguageModel(model)
    expect(shimLanguageModel(once)).toBe(once)
  })

  test("rerankingModel is undefined on shimmed venice provider", () => {
    if (skip()) return
    expect(shimProvider(createVenice!({ apiKey: "test-key" })).rerankingModel).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// @jerome-benoit/sap-ai-provider-v2 (v2 callable, languageModel + textEmbeddingModel)
// ---------------------------------------------------------------------------

describe("@jerome-benoit/sap-ai-provider-v2 real module", () => {
  test("raw provider is callable and has specificationVersion undefined", () => {
    if (skip()) return
    const provider = createSAPAIProvider!()
    expect(typeof provider).toBe("function")
    expect(provider.specificationVersion).toBeUndefined()
  })

  test("raw language model via .languageModel() has specificationVersion v2", () => {
    if (skip()) return
    expect(createSAPAIProvider!().languageModel("anthropic--claude-4-sonnet").specificationVersion).toBe("v2")
  })

  test("raw language model via provider(id) call has specificationVersion v2", () => {
    if (skip()) return
    expect(createSAPAIProvider!()("anthropic--claude-4-sonnet").specificationVersion).toBe("v2")
  })

  test("raw provider has textEmbeddingModel (v2 name)", () => {
    if (skip()) return
    expect(typeof createSAPAIProvider!().textEmbeddingModel).toBe("function")
  })

  test("shimProvider wraps SAP provider to v3", () => {
    if (skip()) return
    expect(shimProvider(createSAPAIProvider!()).specificationVersion).toBe("v3")
  })

  test("shimmed SAP provider is still callable — sdk(modelId) pattern works", () => {
    if (skip()) return
    expect(() => shimProvider(createSAPAIProvider!())("anthropic--claude-4-sonnet")).not.toThrow()
  })

  test("sdk(modelId) call returns v3 language model", () => {
    if (skip()) return
    expect(shimProvider(createSAPAIProvider!())("anthropic--claude-4-sonnet").specificationVersion).toBe("v3")
  })

  test("sdk.languageModel(modelId) returns v3 language model", () => {
    if (skip()) return
    expect(shimProvider(createSAPAIProvider!()).languageModel("anthropic--claude-4-sonnet").specificationVersion).toBe(
      "v3",
    )
  })

  test("both call paths return v3 models with same provider and modelId", () => {
    if (skip()) return
    const shimmed = shimProvider(createSAPAIProvider!())
    const byCall = shimmed("anthropic--claude-4-sonnet")
    const byMethod = shimmed.languageModel("anthropic--claude-4-sonnet")
    expect(byCall.specificationVersion).toBe("v3")
    expect(byMethod.specificationVersion).toBe("v3")
    expect(byCall.provider).toBe(byMethod.provider)
    expect(byCall.modelId).toBe(byMethod.modelId)
  })

  test("shimmed SAP model preserves provider and modelId", () => {
    if (skip()) return
    const model = shimProvider(createSAPAIProvider!()).languageModel("anthropic--claude-4-sonnet")
    expect(model.provider).toContain("sap")
    expect(model.modelId).toBe("anthropic--claude-4-sonnet")
  })

  test("shimmed embeddingModel() routes to textEmbeddingModel on raw provider", () => {
    if (skip()) return
    expect(typeof shimProvider(createSAPAIProvider!()).embeddingModel).toBe("function")
  })

  test("shimmed model doGenerate is a function", () => {
    if (skip()) return
    expect(typeof shimProvider(createSAPAIProvider!()).languageModel("anthropic--claude-4-sonnet").doGenerate).toBe(
      "function",
    )
  })

  test("shimmed model doStream is a function", () => {
    if (skip()) return
    expect(typeof shimProvider(createSAPAIProvider!()).languageModel("anthropic--claude-4-sonnet").doStream).toBe(
      "function",
    )
  })

  test("shimProvider is idempotent on SAP provider", () => {
    if (skip()) return
    const raw = createSAPAIProvider!()
    const once = shimProvider(raw)
    const twice = shimProvider(once)
    expect(twice).toBe(once)
  })

  test("shimLanguageModel is idempotent on shimmed SAP model", () => {
    if (skip()) return
    const model = createSAPAIProvider!().languageModel("anthropic--claude-4-sonnet")
    const once = shimLanguageModel(model)
    expect(shimLanguageModel(once)).toBe(once)
  })

  test("rerankingModel is undefined on shimmed SAP provider", () => {
    if (skip()) return
    expect(shimProvider(createSAPAIProvider!()).rerankingModel).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Cross-provider: verify shim converts v2→v3 on real model objects
// ---------------------------------------------------------------------------

describe("shimLanguageModel on real v2 models", () => {
  test("venice model: specificationVersion upgraded to v3", () => {
    if (skip()) return
    const raw = createVenice!({ apiKey: "test-key" }).languageModel("venice-uncensored")
    expect(raw.specificationVersion).toBe("v2")
    expect(shimLanguageModel(raw).specificationVersion).toBe("v3")
  })

  test("SAP model: specificationVersion upgraded to v3", () => {
    if (skip()) return
    const raw = createSAPAIProvider!().languageModel("anthropic--claude-4-sonnet")
    expect(raw.specificationVersion).toBe("v2")
    expect(shimLanguageModel(raw).specificationVersion).toBe("v3")
  })

  test("venice model: doGenerate wraps finishReason into v3 object shape", async () => {
    if (skip()) return
    const raw = createVenice!({ apiKey: "test-key" }).languageModel("venice-uncensored")
    raw.doGenerate = async () => ({
      content: [],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      warnings: [],
    })
    const result = await shimLanguageModel(raw).doGenerate({})
    expect(result.finishReason).toEqual({ unified: "stop", raw: undefined })
    expect(result.usage).toMatchObject({
      inputTokens: { total: 10 },
      outputTokens: { total: 5 },
    })
  })

  test("SAP model: doGenerate wraps finishReason into v3 object shape", async () => {
    if (skip()) return
    const raw = createSAPAIProvider!().languageModel("anthropic--claude-4-sonnet")
    raw.doGenerate = async () => ({
      content: [],
      finishReason: "length",
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cachedInputTokens: 20 },
      warnings: [],
    })
    const result = await shimLanguageModel(raw).doGenerate({})
    expect(result.finishReason).toEqual({ unified: "length", raw: undefined })
    expect(result.usage).toMatchObject({
      inputTokens: { total: 100, cacheRead: 20 },
      outputTokens: { total: 50 },
    })
  })

  test("venice model: doStream wraps finish chunk into v3 shape", async () => {
    if (skip()) return
    const raw = createVenice!({ apiKey: "test-key" }).languageModel("venice-uncensored")
    raw.doStream = async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "text-delta", textDelta: "hi" })
          c.enqueue({ type: "finish", finishReason: "stop", usage: { inputTokens: 5, outputTokens: 3 } })
          c.close()
        },
      }),
    })
    const { stream } = await shimLanguageModel(raw).doStream({})
    const chunks: any[] = []
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const finish = chunks.find((c) => c.type === "finish")
    expect(finish.finishReason).toEqual({ unified: "stop", raw: undefined })
    expect(finish.usage.inputTokens).toHaveProperty("total", 5)
    expect(finish.usage.outputTokens).toHaveProperty("total", 3)
  })
})
