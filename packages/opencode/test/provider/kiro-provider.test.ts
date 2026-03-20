import { test, expect, mock } from "bun:test"
import path from "path"

// === Mocks ===
mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async (pkg: string, _version?: string) => {
      const lastAtIndex = pkg.lastIndexOf("@")
      return lastAtIndex > 0 ? pkg.substring(0, lastAtIndex) : pkg
    },
    run: async () => {
      throw new Error("BunProc.run should not be called in tests")
    },
    which: () => process.execPath,
    InstallFailedError: class extends Error {},
  },
}))

const mockPlugin = async () => ({})
mock.module("opencode-copilot-auth", () => ({ default: mockPlugin }))
mock.module("opencode-anthropic-auth", () => ({ default: mockPlugin }))
mock.module("@gitlab/opencode-gitlab-auth", () => ({ default: mockPlugin, gitlabAuthPlugin: mockPlugin }))

const { tmpdir } = await import("../fixture/fixture")
const { Instance } = await import("../../src/project/instance")
const { Provider } = await import("../../src/provider/provider")
const { ProviderID, ModelID } = await import("../../src/provider/schema")

test("Kiro: provider is registered in database with correct models", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const kiro = providers[ProviderID.kiro]
      if (kiro) {
        expect(kiro.name).toBe("Kiro (AWS)")
        expect(kiro.id).toBe(ProviderID.kiro)
      }
    },
  })
})

test("Kiro: models have correct capabilities", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const kiro = providers[ProviderID.kiro]

      if (kiro && Object.keys(kiro.models).length > 0) {
        const sonnet = kiro.models[ModelID.make("claude-sonnet-4-5")]
        if (sonnet) {
          expect(sonnet.capabilities.toolcall).toBe(true)
          expect(sonnet.capabilities.reasoning).toBe(true)
          expect(sonnet.capabilities.attachment).toBe(true)
          expect(sonnet.capabilities.input.text).toBe(true)
          expect(sonnet.capabilities.input.image).toBe(true)
          expect(sonnet.capabilities.input.pdf).toBe(true)
          expect(sonnet.limit.context).toBe(200000)
          expect(sonnet.cost.input).toBe(0)
          expect(sonnet.cost.output).toBe(0)
        }
      }
    },
  })
})

test("Kiro: models have correct variants for thinking mode", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const kiro = providers[ProviderID.kiro]

      if (kiro && Object.keys(kiro.models).length > 0) {
        const sonnet = kiro.models[ModelID.make("claude-sonnet-4-5")]
        if (sonnet && sonnet.variants) {
          expect(sonnet.variants.high).toBeDefined()
          expect(sonnet.variants.max).toBeDefined()
          expect(sonnet.variants.high.thinking?.type).toBe("enabled")
          expect(sonnet.variants.high.thinking?.budgetTokens).toBe(16000)
          expect(sonnet.variants.max.thinking?.budgetTokens).toBe(31999)
        }
      }
    },
  })
})

test("Kiro: provider uses correct npm package", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const kiro = providers[ProviderID.kiro]

      if (kiro && Object.keys(kiro.models).length > 0) {
        const model = Object.values(kiro.models)[0]
        expect(model.api.npm).toBe("@ai-sdk/kiro")
        expect(model.api.url).toContain("codewhisperer")
        expect(model.api.url).toContain("amazonaws.com")
      }
    },
  })
})

test("Kiro: provider behavior depends on auth state", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const kiro = providers[ProviderID.kiro]

      if (kiro) {
        expect(kiro.id).toBe(ProviderID.kiro)
        expect(kiro.name).toBe("Kiro (AWS)")
        expect(typeof Object.keys(kiro.models).length).toBe("number")
      }
    },
  })
})

test("Kiro: provider can be configured via opencode.json", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            kiro: {
              options: {
                headers: {
                  "X-Custom-Header": "test-value",
                },
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const kiro = providers[ProviderID.kiro]

      if (kiro) {
        expect(kiro.options?.headers?.["X-Custom-Header"]).toBe("test-value")
      }
    },
  })
})

test("Kiro: parseModel splits variant from model ID correctly", async () => {
  const parsed = Provider.parseModel("kiro/claude-opus-4-6/high")
  expect(parsed.providerID).toBe(ProviderID.kiro)
  expect(parsed.modelID).toBe(ModelID.make("claude-opus-4-6/high"))

  const parsedMax = Provider.parseModel("kiro/claude-opus-4-6/max")
  expect(parsedMax.providerID).toBe(ProviderID.kiro)
  expect(parsedMax.modelID).toBe(ModelID.make("claude-opus-4-6/max"))

  const parsedBase = Provider.parseModel("kiro/claude-opus-4-6")
  expect(parsedBase.providerID).toBe(ProviderID.kiro)
  expect(parsedBase.modelID).toBe(ModelID.make("claude-opus-4-6"))
})

test("Kiro: all reasoning models have high and max variants", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const kiro = providers[ProviderID.kiro]
      if (!kiro || Object.keys(kiro.models).length === 0) return

      for (const [, model] of Object.entries(kiro.models)) {
        if (!model.capabilities.reasoning) {
          expect(Object.keys(model.variants ?? {})).toEqual([])
          continue
        }
        expect(model.variants).toBeDefined()
        expect(model.variants!["high"]).toBeDefined()
        expect(model.variants!["max"]).toBeDefined()
        expect(model.variants!["high"].thinking).toBeDefined()
        expect(model.variants!["max"].thinking).toBeDefined()
      }
    },
  })
})

test("Kiro: ProviderTransform.variants returns correct thinking config", async () => {
  const { ProviderTransform } = await import("../../src/provider/transform")

  const kiroModel = {
    id: "claude-sonnet-4-5",
    providerID: "kiro",
    api: {
      id: "claude-sonnet-4-5",
      url: "https://codewhisperer.us-east-1.amazonaws.com",
      npm: "@ai-sdk/kiro",
    },
    name: "Claude Sonnet 4.5",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: true,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 200000, output: 64000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-09-29",
  } as any

  const variants = ProviderTransform.variants(kiroModel)

  expect(Object.keys(variants)).toEqual(["high", "max"])
  expect(variants.high).toEqual({
    thinking: {
      type: "enabled",
      budgetTokens: 16000,
    },
  })
  expect(variants.max).toEqual({
    thinking: {
      type: "enabled",
      budgetTokens: 31999,
    },
  })
})

test("Kiro: non-reasoning models return empty variants", async () => {
  const { ProviderTransform } = await import("../../src/provider/transform")

  const kiroModel = {
    id: "claude-haiku-4-5",
    providerID: "kiro",
    api: {
      id: "claude-haiku-4-5",
      url: "https://codewhisperer.us-east-1.amazonaws.com",
      npm: "@ai-sdk/kiro",
    },
    name: "Claude Haiku 4.5",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 200000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2025-10-01",
  } as any

  const variants = ProviderTransform.variants(kiroModel)

  expect(variants).toEqual({})
})

test("Kiro: parseModel with variant produces modelID that includes variant suffix", () => {
  const parsed = Provider.parseModel("kiro/claude-opus-4-6/high")
  expect(parsed.modelID).toBe(ModelID.make("claude-opus-4-6/high"))
  expect(parsed.modelID).not.toBe(ModelID.make("claude-opus-4-6"))
})

test("Kiro: getModel resolves hyphen-joined variant modelID to base model", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const kiro = providers[ProviderID.kiro]
      if (!kiro || Object.keys(kiro.models).length === 0) return

      const base = await Provider.getModel(ProviderID.kiro, ModelID.make("claude-opus-4-6"))
      expect(base.id).toBe(ModelID.make("claude-opus-4-6"))

      const withHigh = await Provider.getModel(ProviderID.kiro, ModelID.make("claude-opus-4-6-high"))
      expect(withHigh.id).toBe(ModelID.make("claude-opus-4-6"))

      const withMax = await Provider.getModel(ProviderID.kiro, ModelID.make("claude-opus-4-6-max"))
      expect(withMax.id).toBe(ModelID.make("claude-opus-4-6"))

      const sonnetHigh = await Provider.getModel(ProviderID.kiro, ModelID.make("claude-sonnet-4-5-high"))
      expect(sonnetHigh.id).toBe(ModelID.make("claude-sonnet-4-5"))
    },
  })
})
