import { describe, test, expect, mock } from "bun:test"
import { shimLanguageModel, shimProvider } from "../../src/provider/shim"

// ---------------------------------------------------------------------------
// Helpers — minimal v2 / v3 fakes
// ---------------------------------------------------------------------------

function makeV2LanguageModel(overrides: Record<string, any> = {}) {
  return {
    specificationVersion: "v2" as const,
    provider: "test-provider",
    modelId: "test-model",
    doGenerate: mock(async () => ({
      content: [],
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      warnings: [],
    })),
    doStream: mock(async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-delta", textDelta: "hello" })
          controller.enqueue({
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          })
          controller.close()
        },
      }),
    })),
    ...overrides,
  }
}

function makeV3LanguageModel(overrides: Record<string, any> = {}) {
  return {
    specificationVersion: "v3" as const,
    provider: "test-provider",
    modelId: "test-model-v3",
    doGenerate: mock(async () => ({})),
    doStream: mock(async () => ({})),
    ...overrides,
  }
}

function makeV2Provider(overrides: Record<string, any> = {}) {
  const model = makeV2LanguageModel()
  return {
    languageModel: mock((_id: string) => model),
    textEmbeddingModel: mock((_id: string) => ({ specificationVersion: "v2", modelId: "embed" })),
    imageModel: mock((_id: string) => ({ specificationVersion: "v2", modelId: "img" })),
    transcriptionModel: undefined,
    speechModel: undefined,
    ...overrides,
  }
}

function makeCallableV2Provider(overrides: Record<string, any> = {}) {
  const model = makeV2LanguageModel()
  const fn = Object.assign(
    function (modelId: string) {
      return model
    },
    {
      languageModel: mock((_id: string) => model),
      textEmbeddingModel: mock((_id: string) => ({ specificationVersion: "v2", modelId: "embed" })),
      imageModel: undefined,
      transcriptionModel: undefined,
      speechModel: undefined,
      ...overrides,
    },
  )
  return fn
}

function makeV3Provider(overrides: Record<string, any> = {}) {
  return {
    specificationVersion: "v3" as const,
    languageModel: mock((_id: string) => makeV3LanguageModel()),
    embeddingModel: mock((_id: string) => ({})),
    imageModel: mock((_id: string) => ({})),
    ...overrides,
  }
}

// Read all chunks from a ReadableStream into an array
async function collectStream(stream: ReadableStream) {
  const chunks: any[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return chunks
}

// ---------------------------------------------------------------------------
// shimLanguageModel
// ---------------------------------------------------------------------------

describe("shimLanguageModel", () => {
  describe("fast-path", () => {
    test("returns v3 model unchanged", () => {
      const model = makeV3LanguageModel()
      expect(shimLanguageModel(model)).toBe(model)
    })

    test("does not wrap twice — idempotent", () => {
      const model = makeV2LanguageModel()
      const once = shimLanguageModel(model)
      const twice = shimLanguageModel(once)
      expect(twice).toBe(once)
    })
  })

  describe("specificationVersion", () => {
    test("reports v3 on shimmed model", () => {
      const shimmed = shimLanguageModel(makeV2LanguageModel())
      expect(shimmed.specificationVersion).toBe("v3")
    })

    test("preserves other properties unchanged", () => {
      const model = makeV2LanguageModel()
      const shimmed = shimLanguageModel(model)
      expect(shimmed.provider).toBe("test-provider")
      expect(shimmed.modelId).toBe("test-model")
    })
  })

  describe("doGenerate", () => {
    test("converts flat finishReason string to v3 object", async () => {
      const shimmed = shimLanguageModel(makeV2LanguageModel())
      const result = await shimmed.doGenerate({})
      expect(result.finishReason).toEqual({ unified: "stop", raw: undefined })
    })

    test('maps finishReason "unknown" → "other"', async () => {
      const model = makeV2LanguageModel({
        doGenerate: mock(async () => ({
          content: [],
          finishReason: "unknown",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          warnings: [],
        })),
      })
      const result = await shimLanguageModel(model).doGenerate({})
      expect(result.finishReason).toEqual({ unified: "other", raw: undefined })
    })

    test("preserves all other finishReason values verbatim", async () => {
      for (const reason of ["length", "content-filter", "tool-calls", "error"]) {
        const model = makeV2LanguageModel({
          doGenerate: mock(async () => ({
            content: [],
            finishReason: reason,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            warnings: [],
          })),
        })
        const result = await shimLanguageModel(model).doGenerate({})
        expect(result.finishReason.unified).toBe(reason)
      }
    })

    test("converts flat usage to v3 nested structure", async () => {
      const model = makeV2LanguageModel({
        doGenerate: mock(async () => ({
          content: [],
          finishReason: "stop",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            cachedInputTokens: 20,
            reasoningTokens: 10,
          },
          warnings: [],
        })),
      })
      const result = await shimLanguageModel(model).doGenerate({})
      expect(result.usage).toEqual({
        inputTokens: { total: 100, noCache: undefined, cacheRead: 20, cacheWrite: undefined },
        outputTokens: { total: 50, text: undefined, reasoning: 10 },
      })
    })

    test("handles undefined optional usage fields gracefully", async () => {
      const result = await shimLanguageModel(makeV2LanguageModel()).doGenerate({})
      expect(result.usage.inputTokens.cacheRead).toBeUndefined()
      expect(result.usage.outputTokens.reasoning).toBeUndefined()
    })

    test("spreads all other result fields through unchanged", async () => {
      const model = makeV2LanguageModel({
        doGenerate: mock(async () => ({
          content: [{ type: "text", text: "hello" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          warnings: [{ type: "other", message: "test" }],
          providerMetadata: { foo: "bar" },
        })),
      })
      const result = await shimLanguageModel(model).doGenerate({})
      expect(result.content).toEqual([{ type: "text", text: "hello" }])
      expect(result.warnings).toEqual([{ type: "other", message: "test" }])
      expect(result.providerMetadata).toEqual({ foo: "bar" })
    })

    test("forwards call arguments to underlying doGenerate", async () => {
      const model = makeV2LanguageModel()
      const shimmed = shimLanguageModel(model)
      const options = { prompt: [{ role: "user", content: "hi" }] }
      await shimmed.doGenerate(options)
      expect(model.doGenerate).toHaveBeenCalledWith(options)
    })
  })

  describe("doStream", () => {
    test("passes non-finish chunks through unchanged", async () => {
      const shimmed = shimLanguageModel(makeV2LanguageModel())
      const { stream } = await shimmed.doStream({})
      const chunks = await collectStream(stream)
      expect(chunks[0]).toEqual({ type: "text-delta", textDelta: "hello" })
    })

    test("converts finish chunk finishReason to v3 object", async () => {
      const shimmed = shimLanguageModel(makeV2LanguageModel())
      const { stream } = await shimmed.doStream({})
      const chunks = await collectStream(stream)
      const finish = chunks.find((c) => c.type === "finish")
      expect(finish?.finishReason).toEqual({ unified: "stop", raw: undefined })
    })

    test("converts finish chunk usage to v3 nested structure", async () => {
      const model = makeV2LanguageModel({
        doStream: mock(async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: "finish",
                finishReason: "stop",
                usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 3, reasoningTokens: 2 },
              })
              controller.close()
            },
          }),
        })),
      })
      const { stream } = await shimLanguageModel(model).doStream({})
      const [finish] = await collectStream(stream)
      expect(finish.usage).toEqual({
        inputTokens: { total: 10, noCache: undefined, cacheRead: 3, cacheWrite: undefined },
        outputTokens: { total: 5, text: undefined, reasoning: 2 },
      })
    })

    test("preserves finish chunk fields beyond finishReason and usage", async () => {
      const model = makeV2LanguageModel({
        doStream: mock(async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: "finish",
                finishReason: "stop",
                usage: { inputTokens: 1, outputTokens: 1 },
                providerMetadata: { extra: true },
              })
              controller.close()
            },
          }),
        })),
      })
      const { stream } = await shimLanguageModel(model).doStream({})
      const [chunk] = await collectStream(stream)
      expect(chunk.providerMetadata).toEqual({ extra: true })
    })

    test("spreads other doStream result fields through unchanged", async () => {
      const model = makeV2LanguageModel({
        doStream: mock(async () => ({
          stream: new ReadableStream({
            start(c) {
              c.close()
            },
          }),
          response: { headers: { "x-custom": "yes" } },
        })),
      })
      const result = await shimLanguageModel(model).doStream({})
      expect(result.response).toEqual({ headers: { "x-custom": "yes" } })
    })

    test("forwards call arguments to underlying doStream", async () => {
      const model = makeV2LanguageModel()
      const shimmed = shimLanguageModel(model)
      const options = { prompt: [{ role: "user", content: "hi" }] }
      await shimmed.doStream(options)
      expect(model.doStream).toHaveBeenCalledWith(options)
    })
  })
})

// ---------------------------------------------------------------------------
// shimProvider
// ---------------------------------------------------------------------------

describe("shimProvider", () => {
  describe("fast-path", () => {
    test("returns v3 provider unchanged", () => {
      const provider = makeV3Provider()
      expect(shimProvider(provider)).toBe(provider)
    })

    test("idempotent — shimming a shimmed provider returns the same shim", () => {
      const provider = makeV2Provider()
      const once = shimProvider(provider)
      const twice = shimProvider(once)
      expect(twice).toBe(once)
    })
  })

  describe("specificationVersion", () => {
    test("reports v3 on shimmed object provider", () => {
      expect(shimProvider(makeV2Provider()).specificationVersion).toBe("v3")
    })

    test("reports v3 on shimmed callable provider", () => {
      expect(shimProvider(makeCallableV2Provider()).specificationVersion).toBe("v3")
    })
  })

  describe("languageModel()", () => {
    test("returns a shimmed language model (specificationVersion v3)", () => {
      const shimmed = shimProvider(makeV2Provider())
      const model = shimmed.languageModel("test-model")
      expect(model.specificationVersion).toBe("v3")
    })

    test("forwards modelId to the underlying languageModel()", () => {
      const provider = makeV2Provider()
      shimProvider(provider).languageModel("my-model")
      expect(provider.languageModel).toHaveBeenCalledWith("my-model")
    })

    test("doGenerate on the returned model converts v2 usage to v3", async () => {
      const provider = makeV2Provider()
      const model = shimProvider(provider).languageModel("test")
      const result = await model.doGenerate({})
      expect(result.usage).toHaveProperty("inputTokens")
      expect(result.usage.inputTokens).toHaveProperty("total")
    })
  })

  describe("callable provider (apply trap)", () => {
    test("shimmed callable provider can be called as a function", () => {
      const provider = makeCallableV2Provider()
      const shimmed = shimProvider(provider)
      expect(() => shimmed("some-model")).not.toThrow()
    })

    test("calling shimmed provider as function returns shimmed language model", () => {
      const shimmed = shimProvider(makeCallableV2Provider())
      const model = shimmed("some-model")
      expect(model.specificationVersion).toBe("v3")
    })

    test("doGenerate on the model returned from callable shim converts usage", async () => {
      const shimmed = shimProvider(makeCallableV2Provider())
      const model = shimmed("some-model")
      const result = await model.doGenerate({})
      expect(result.usage.inputTokens).toHaveProperty("total")
      expect(result.finishReason).toHaveProperty("unified")
    })
  })

  describe("embeddingModel()", () => {
    test("maps textEmbeddingModel (v2 name) to embeddingModel (v3)", () => {
      const provider = makeV2Provider()
      const shimmed = shimProvider(provider)
      shimmed.embeddingModel("embed-model")
      expect(provider.textEmbeddingModel).toHaveBeenCalledWith("embed-model")
    })

    test("falls back to embeddingModel if textEmbeddingModel absent", () => {
      const embeddingModel = mock((_id: string) => ({}))
      const provider = makeV2Provider({ textEmbeddingModel: undefined, embeddingModel })
      shimProvider(provider).embeddingModel("embed-model")
      expect(embeddingModel).toHaveBeenCalledWith("embed-model")
    })

    test("returns undefined if neither textEmbeddingModel nor embeddingModel present", () => {
      const provider = makeV2Provider({ textEmbeddingModel: undefined, embeddingModel: undefined })
      expect(shimProvider(provider).embeddingModel).toBeUndefined()
    })
  })

  describe("imageModel()", () => {
    test("proxies through to underlying imageModel()", () => {
      const provider = makeV2Provider()
      shimProvider(provider).imageModel("img-model")
      expect(provider.imageModel).toHaveBeenCalledWith("img-model")
    })

    test("returns undefined when imageModel absent on provider", () => {
      const provider = makeV2Provider({ imageModel: undefined })
      expect(shimProvider(provider).imageModel).toBeUndefined()
    })
  })

  describe("transcriptionModel()", () => {
    test("proxies through to underlying transcriptionModel()", () => {
      const transcriptionModel = mock((_id: string) => ({}))
      const provider = makeV2Provider({ transcriptionModel })
      shimProvider(provider).transcriptionModel("whisper")
      expect(transcriptionModel).toHaveBeenCalledWith("whisper")
    })

    test("returns undefined when transcriptionModel absent", () => {
      const provider = makeV2Provider({ transcriptionModel: undefined })
      expect(shimProvider(provider).transcriptionModel).toBeUndefined()
    })
  })

  describe("speechModel()", () => {
    test("proxies through to underlying speechModel()", () => {
      const speechModel = mock((_id: string) => ({}))
      const provider = makeV2Provider({ speechModel })
      shimProvider(provider).speechModel("tts")
      expect(speechModel).toHaveBeenCalledWith("tts")
    })

    test("returns undefined when speechModel absent", () => {
      expect(shimProvider(makeV2Provider({ speechModel: undefined })).speechModel).toBeUndefined()
    })
  })

  describe("rerankingModel()", () => {
    test("always returns undefined — v2 providers have no reranking concept", () => {
      const provider = makeV2Provider({ rerankingModel: mock(() => ({})) })
      expect(shimProvider(provider).rerankingModel).toBeUndefined()
    })
  })

  describe("other properties", () => {
    test("forwards unknown properties from the underlying provider", () => {
      const provider = Object.assign(makeV2Provider(), { customProp: "hello" })
      expect(shimProvider(provider).customProp).toBe("hello")
    })
  })
})

// ---------------------------------------------------------------------------
// Venice-style provider (v2 object provider, no callable)
// ---------------------------------------------------------------------------

describe("venice-style provider compatibility", () => {
  function makeVeniceProvider() {
    return {
      languageModel: mock((id: string) => makeV2LanguageModel({ modelId: id })),
      textEmbeddingModel: mock((_id: string) => ({ specificationVersion: "v2", modelId: "embed" })),
      imageModel: mock((_id: string) => ({ specificationVersion: "v2", modelId: "img" })),
    }
  }

  test("shimProvider wraps a venice-style v2 provider", () => {
    const shimmed = shimProvider(makeVeniceProvider())
    expect(shimmed.specificationVersion).toBe("v3")
  })

  test("languageModel() returns v3-compatible model", () => {
    const model = shimProvider(makeVeniceProvider()).languageModel("venice-llama-3-3-70b")
    expect(model.specificationVersion).toBe("v3")
  })

  test("doGenerate produces v3 usage shape", async () => {
    const shimmed = shimProvider(makeVeniceProvider())
    const result = await shimmed.languageModel("test").doGenerate({})
    expect(result.usage).toEqual({
      inputTokens: { total: 100, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 50, text: undefined, reasoning: undefined },
    })
  })

  test("doStream produces v3 finish chunk shape", async () => {
    const shimmed = shimProvider(makeVeniceProvider())
    const { stream } = await shimmed.languageModel("test").doStream({})
    const chunks = await collectStream(stream)
    const finish = chunks.find((c) => c.type === "finish")
    expect(finish?.finishReason).toEqual({ unified: "stop", raw: undefined })
    expect(finish?.usage.inputTokens).toHaveProperty("total")
  })

  test("textEmbeddingModel is accessible via embeddingModel", () => {
    const provider = makeVeniceProvider()
    shimProvider(provider).embeddingModel("embed-id")
    expect(provider.textEmbeddingModel).toHaveBeenCalledWith("embed-id")
  })
})

// ---------------------------------------------------------------------------
// SAP-AI-Core-style provider (callable function + .languageModel())
// ---------------------------------------------------------------------------

describe("sap-ai-core-style provider compatibility", () => {
  function makeSapProvider() {
    const model = makeV2LanguageModel({ modelId: "anthropic--claude-4-sonnet" })
    const fn = Object.assign(
      function (modelId: string) {
        return model
      },
      {
        languageModel: mock((_id: string) => model),
        textEmbeddingModel: mock((_id: string) => ({ specificationVersion: "v2" })),
        imageModel: (_id: string) => {
          throw new Error("No image models")
        },
      },
    )
    return fn
  }

  test("shimProvider wraps a callable v2 provider", () => {
    const shimmed = shimProvider(makeSapProvider())
    expect(shimmed.specificationVersion).toBe("v3")
  })

  test("calling shimmed provider as function (sdk(modelId)) works", () => {
    const shimmed = shimProvider(makeSapProvider())
    expect(() => shimmed("anthropic--claude-4-sonnet")).not.toThrow()
  })

  test("sdk(modelId) returns a v3-compatible language model", () => {
    const shimmed = shimProvider(makeSapProvider())
    const model = shimmed("anthropic--claude-4-sonnet")
    expect(model.specificationVersion).toBe("v3")
  })

  test("sdk(modelId) doGenerate converts v2 usage and finishReason", async () => {
    const shimmed = shimProvider(makeSapProvider())
    const model = shimmed("anthropic--claude-4-sonnet")
    const result = await model.doGenerate({})
    expect(result.finishReason).toEqual({ unified: "stop", raw: undefined })
    expect(result.usage.inputTokens).toHaveProperty("total")
  })

  test("sdk.languageModel(id) also works and returns v3 model", () => {
    const shimmed = shimProvider(makeSapProvider())
    const model = shimmed.languageModel("anthropic--claude-4-sonnet")
    expect(model.specificationVersion).toBe("v3")
  })

  test("both call paths return equivalent shimmed models", async () => {
    const shimmed = shimProvider(makeSapProvider())
    const byCall = shimmed("test-model")
    const byMethod = shimmed.languageModel("test-model")
    // Both should be shimmed v3 models
    expect(byCall.specificationVersion).toBe("v3")
    expect(byMethod.specificationVersion).toBe("v3")
  })
})
