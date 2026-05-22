import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { GithubCopilotPlugin } from "@opencode-ai/core/plugin/provider/github-copilot"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { fakeSelectorSdk, it, model } from "./provider-helper"

describe("GithubCopilotPlugin", () => {
  it.effect("creates the bundled Copilot SDK for the GitHub Copilot package", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GithubCopilotPlugin)
      const ignored = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("github-copilot", "gpt-5"),
          package: "@ai-sdk/openai-compatible",
          options: { name: "github-copilot" },
        },
        {},
      )
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        {
          model: model("github-copilot", "gpt-5"),
          package: "@ai-sdk/github-copilot",
          options: { name: "github-copilot" },
        },
        {},
      )
      expect(ignored.sdk).toBeUndefined()
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("selects languageModel when responses and chat are absent", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(GithubCopilotPlugin)
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("github-copilot", "claude-sonnet-4"),
          sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
          options: {},
        },
        {},
      )
      expect(calls).toEqual(["languageModel:claude-sonnet-4"])
    }),
  )

  it.effect("selects languageModel with the API model ID when responses and chat are absent", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(GithubCopilotPlugin)
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("github-copilot", "alias", { apiID: ModelV2.ID.make("claude-sonnet-4") }),
          sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
          options: {},
        },
        {},
      )
      expect(calls).toEqual(["languageModel:claude-sonnet-4"])
    }),
  )

  it.effect("uses responses for gpt-5 models except gpt-5-mini", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(GithubCopilotPlugin)
      yield* plugin.trigger(
        "aisdk.language",
        { model: model("github-copilot", "gpt-5"), sdk: fakeSelectorSdk(calls), options: {} },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        { model: model("github-copilot", "gpt-5.1-codex"), sdk: fakeSelectorSdk(calls), options: {} },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        { model: model("github-copilot", "gpt-4o"), sdk: fakeSelectorSdk(calls), options: {} },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        { model: model("github-copilot", "gpt-5-mini"), sdk: fakeSelectorSdk(calls), options: {} },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        { model: model("github-copilot", "gpt-5-mini-2025-08-07"), sdk: fakeSelectorSdk(calls), options: {} },
        {},
      )
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
      const calls: string[] = []
      yield* plugin.add(GithubCopilotPlugin)
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("github-copilot", "default", { apiID: ModelV2.ID.make("gpt-5") }),
          sdk: fakeSelectorSdk(calls),
          options: {},
        },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("github-copilot", "small", { apiID: ModelV2.ID.make("gpt-5-mini") }),
          sdk: fakeSelectorSdk(calls),
          options: {},
        },
        {},
      )
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("github-copilot", "sonnet", { apiID: ModelV2.ID.make("claude-sonnet-4") }),
          sdk: fakeSelectorSdk(calls),
          options: {},
        },
        {},
      )
      expect(calls).toEqual(["responses:gpt-5", "chat:gpt-5-mini", "chat:claude-sonnet-4"])
    }),
  )

  it.effect("disables gpt-5-chat-latest before Copilot language selection", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(GithubCopilotPlugin)
      const load = yield* catalog.loader()
      yield* load((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("github-copilot"), () => {})
        catalog.model.update(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("gpt-5-chat-latest"), () => {})
      })
      expect(
        (yield* catalog.model.get(ProviderV2.ID.make("github-copilot"), ModelV2.ID.make("gpt-5-chat-latest"))).enabled,
      ).toBe(false)
    }),
  )

  it.effect("does not disable gpt-5-chat-latest for non-Copilot providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const catalog = yield* Catalog.Service
      yield* plugin.add(GithubCopilotPlugin)
      const load = yield* catalog.loader()
      yield* load((catalog) => {
        catalog.provider.update(ProviderV2.ID.make("custom-copilot"), () => {})
        catalog.model.update(ProviderV2.ID.make("custom-copilot"), ModelV2.ID.make("gpt-5-chat-latest"), () => {})
      })
      expect(
        (yield* catalog.model.get(ProviderV2.ID.make("custom-copilot"), ModelV2.ID.make("gpt-5-chat-latest"))).enabled,
      ).toBe(true)
    }),
  )

  it.effect("ignores non-Copilot providers", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: string[] = []
      yield* plugin.add(GithubCopilotPlugin)
      const result = yield* plugin.trigger(
        "aisdk.language",
        { model: model("openai", "gpt-5"), sdk: fakeSelectorSdk(calls), options: {} },
        {},
      )
      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )
})
