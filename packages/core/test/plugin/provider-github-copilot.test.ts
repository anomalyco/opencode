import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { GithubCopilotPlugin } from "@opencode-ai/core/plugin/provider/github-copilot"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* GithubCopilotPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

function fakeSelectorSdk(calls: string[]) {
  const make = (method: string) => (id: string) => {
    calls.push(`${method}:${id}`)
    return { modelId: id, provider: method, specificationVersion: "v3" } as unknown as LanguageModelV3
  }
  return {
    responses: make("responses"),
    messages: make("messages"),
    chat: make("chat"),
    languageModel: make("languageModel"),
  }
}

describe("GithubCopilotPlugin", () => {
  it.effect("creates the bundled Copilot SDK for the GitHub Copilot package", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const ignored = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("gpt-5")),
          modelID: ModelV2.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "github-copilot" },
      })
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("gpt-5")),
          modelID: ModelV2.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/github-copilot",
        options: { name: "github-copilot" },
      })
      expect(ignored.sdk).toBeUndefined()
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("selects languageModel when responses and chat are absent", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("claude-sonnet-4")),
          modelID: ModelV2.ID.make("claude-sonnet-4"),
          package: "aisdk:test-provider",
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: {},
      })
      expect(calls).toEqual(["languageModel:claude-sonnet-4"])
    }),
  )

  it.effect("selects languageModel with the API model ID when responses and chat are absent", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("alias")),
          modelID: ModelV2.ID.make("claude-sonnet-4"),
          package: "aisdk:test-provider",
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: {},
      })
      expect(calls).toEqual(["languageModel:claude-sonnet-4"])
    }),
  )

  it.effect("uses responses for gpt-5 models except gpt-5-mini", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("gpt-5")),
          modelID: ModelV2.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("gpt-5.1-codex")),
          modelID: ModelV2.ID.make("gpt-5.1-codex"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("gpt-4o")),
          modelID: ModelV2.ID.make("gpt-4o"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("gpt-5-mini")),
          modelID: ModelV2.ID.make("gpt-5-mini"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("gpt-5-mini-2025-08-07")),
          modelID: ModelV2.ID.make("gpt-5-mini-2025-08-07"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual([
        "responses:gpt-5",
        "responses:gpt-5.1-codex",
        "chat:gpt-4o",
        "chat:gpt-5-mini",
        "chat:gpt-5-mini-2025-08-07",
      ])
    }),
  )

  it.effect("uses the API model ID when selecting responses or chat", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("default")),
          modelID: ModelV2.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("small")),
          modelID: ModelV2.ID.make("gpt-5-mini"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("sonnet")),
          modelID: ModelV2.ID.make("claude-sonnet-4"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual(["responses:gpt-5", "chat:gpt-5-mini", "chat:claude-sonnet-4"])
    }),
  )

  it.effect("disables gpt-5-chat-latest before Copilot language selection", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("github-copilot"), () => {})
        catalog.model.update(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(
        required(yield* catalog.model.get(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("gpt-5-chat-latest")))
          .enabled,
      ).toBe(false)
    }),
  )

  it.effect("does not disable gpt-5-chat-latest for non-Copilot providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("custom-copilot"), () => {})
        catalog.model.update(ProviderV2.ID.make("custom-copilot"), ModelV2.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(
        required(yield* catalog.model.get(ProviderV2.ID.make("custom-copilot"), ModelV2.ID.make("gpt-5-chat-latest")))
          .enabled,
      ).toBe(true)
    }),
  )

  it.effect("ignores non-Copilot providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("openai"), ModelV2.ID.make("gpt-5")),
          modelID: ModelV2.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )
})
