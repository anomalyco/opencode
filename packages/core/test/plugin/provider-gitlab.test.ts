import { AISDK } from "@opencode/core/aisdk"
import { beforeEach, describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import type { WorkflowDiscoveryConfig, WorkflowDiscoveryOptions, WorkflowDiscoveryResult } from "gitlab-ai-provider"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { GitLabPlugin } from "@opencode/core/plugin/provider/gitlab"
import { Provider } from "@opencode/core/provider"
import { withEnv } from "../fixture/env"
import { drain } from "../lib/clock"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const gitlabSDKOptions: Record<string, unknown>[] = []
const discoverWorkflowModels = mock(
  async (_config: WorkflowDiscoveryConfig, _options: WorkflowDiscoveryOptions): Promise<WorkflowDiscoveryResult> => ({
    models: [],
    project: null,
  }),
)
const it = testEffect(PluginTestLayer)
const providerID = Provider.ID.gitlab
const integrationID = Integration.ID.make("gitlab")

const discovered: WorkflowDiscoveryResult = {
  project: null,
  models: [
    {
      id: "duo-workflow-new-model",
      ref: "new_model_ref",
      name: "New Model",
      context: 128_000,
      output: 16_000,
      pinned: false,
    },
    {
      id: "duo-workflow-default",
      ref: "__default__duo_agent_platform_agentic_chat",
      name: "Default",
      context: 200_000,
      output: 64_000,
      pinned: false,
    },
  ],
}

const discoveryFixture = Effect.gen(function* () {
  const integrations = yield* Integration.Service
  const providers = yield* Provider.Service
  yield* integrations.transform((editor) => {
    editor.method.update({ integrationID, method: { type: "key" } })
    editor.method.update({ integrationID, method: { type: "env", names: ["GITLAB_TOKEN"] } })
  })
  yield* providers.transform((editor) => {
    editor.update(providerID, (provider) => {
      provider.package = Provider.aisdk("gitlab-ai-provider")
    })
    editor.models.update(providerID, Model.ID.make("duo-chat-sonnet-5"), () => {})
  })
  return { providers, models: yield* Model.Service, credentials: yield* Credential.Service }
})

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* GitLabPlugin.effect(host)
})

void mock.module("gitlab-ai-provider", () => ({
  VERSION: "test-version",
  createGitLab: (options: Record<string, unknown>) => {
    gitlabSDKOptions.push(options)
    return {
      agenticChat: (id: string, options: unknown) => ({ id, options, type: "agentic" }),
      workflowChat: (id: string, options: unknown) => ({ id, options, type: "workflow" }),
    }
  },
  discoverWorkflowModels,
  isWorkflowModel: (id: string) => id === "duo-workflow" || id === "duo-workflow-exact",
}))

describe("GitLabPlugin", () => {
  beforeEach(() => {
    discoverWorkflowModels.mockReset()
    discoverWorkflowModels.mockResolvedValue({ models: [], project: null })
  })

  it.effect("discovers workflow models for the location and exposes their refs in the model registry", () =>
    withEnv({ GITLAB_TOKEN: undefined }, () =>
      Effect.gen(function* () {
        const fixture = yield* discoveryFixture
        const location = yield* Location.Service
        const aisdk = yield* AISDK.Service
        yield* fixture.providers.transform((editor) => {
          editor.update(providerID, (provider) => {
            provider.settings = { instanceUrl: "https://configured.gitlab.example" }
          })
        })
        const saved = yield* fixture.credentials.create({ integrationID, value: { type: "key", key: "pat-token" } })
        discoverWorkflowModels.mockResolvedValue(discovered)
        yield* addPlugin()
        yield* drain

        expect(discoverWorkflowModels).toHaveBeenCalledTimes(1)
        const [config, options] = discoverWorkflowModels.mock.calls[0]!
        expect(options).toEqual({ workingDirectory: location.directory, cacheKey: saved.id })
        expect(config.instanceUrl).toBe("https://configured.gitlab.example")
        expect(config.getHeaders()).toEqual({ "PRIVATE-TOKEN": "pat-token" })
        expect((yield* fixture.models.available()).map((model) => model.id).sort()).toEqual([
          Model.ID.make("duo-chat-sonnet-5"),
          Model.ID.make("duo-workflow-default"),
          Model.ID.make("duo-workflow-new-model"),
        ])
        const model = (yield* fixture.models.get(providerID, Model.ID.make("duo-workflow-new-model")))!
        expect(model).toMatchObject({
          name: "Agent Platform (New Model)",
          package: "aisdk:gitlab-ai-provider",
          settings: { workflowRef: "new_model_ref" },
          limit: { context: 128_000, output: 16_000 },
          capabilities: { tools: true },
        })
        const result = yield* aisdk.runLanguage({
          model,
          options: {},
          sdk: { workflowChat: (id: string) => ({ id }) },
        })
        expect(result.language as unknown).toMatchObject({ id: "duo-workflow", selectedModelRef: "new_model_ref" })
      }),
    ),
  )

  it.effect("uses OAuth access tokens for discovery", () =>
    withEnv({ GITLAB_TOKEN: undefined }, () =>
      Effect.gen(function* () {
        const fixture = yield* discoveryFixture
        yield* fixture.credentials.create({
          integrationID,
          value: {
            type: "oauth",
            methodID: Integration.MethodID.make("oauth"),
            access: "access-token",
            refresh: "refresh-token",
            expires: 0,
          },
        })
        yield* addPlugin()
        yield* drain
        expect(discoverWorkflowModels).toHaveBeenCalledTimes(1)
        expect(discoverWorkflowModels.mock.calls[0]![0].getHeaders()).toEqual({ Authorization: "Bearer access-token" })
      }),
    ),
  )

  it.effect("does not discover with only an ambient GITLAB_TOKEN or configured apiKey", () =>
    withEnv({ GITLAB_TOKEN: "env-token" }, () =>
      Effect.gen(function* () {
        const fixture = yield* discoveryFixture
        yield* fixture.providers.transform((editor) => {
          editor.update(providerID, (provider) => {
            provider.settings = { apiKey: "configured-token" }
          })
        })
        discoverWorkflowModels.mockResolvedValue(discovered)
        yield* addPlugin()
        yield* drain
        expect(discoverWorkflowModels).not.toHaveBeenCalled()
        expect(yield* fixture.models.get(providerID, Model.ID.make("duo-workflow-default"))).toBeUndefined()
      }),
    ),
  )

  it.effect("discovers with a stored login without replacing configured model definitions", () =>
    withEnv({ GITLAB_TOKEN: undefined, GITLAB_INSTANCE_URL: "https://env.gitlab.example" }, () =>
      Effect.gen(function* () {
        const fixture = yield* discoveryFixture
        yield* fixture.providers.transform((editor) => {
          editor.models.update(providerID, Model.ID.make("duo-workflow-new-model"), (model) => {
            model.name = "Configured model"
            model.limit.output = 42
          })
        })
        yield* fixture.credentials.create({ integrationID, value: { type: "key", key: "stored-token" } })
        discoverWorkflowModels.mockResolvedValue(discovered)
        yield* addPlugin()
        yield* drain
        expect(discoverWorkflowModels.mock.calls[0]![0].instanceUrl).toBe("https://env.gitlab.example")
        expect(discoverWorkflowModels.mock.calls[0]![0].getHeaders()).toEqual({ "PRIVATE-TOKEN": "stored-token" })
        expect(yield* fixture.models.get(providerID, Model.ID.make("duo-workflow-new-model"))).toMatchObject({
          name: "Configured model",
          limit: { output: 42 },
        })
        expect(yield* fixture.models.get(providerID, Model.ID.make("duo-workflow-default"))).toBeDefined()
      }),
    ),
  )

  it.effect("scopes the SDK discovery cache to the active account", () =>
    withEnv({ GITLAB_TOKEN: undefined }, () =>
      Effect.gen(function* () {
        const fixture = yield* discoveryFixture
        const first = yield* fixture.credentials.create({ integrationID, value: { type: "key", key: "first" } })
        yield* addPlugin()
        yield* drain
        const second = yield* fixture.credentials.create({ integrationID, value: { type: "key", key: "second" } })
        yield* drain
        expect(discoverWorkflowModels.mock.calls.map(([, options]) => options.cacheKey)).toEqual([first.id, second.id])
      }),
    ),
  )

  it.effect("gives up on unresponsive discovery so later account switches still load", () =>
    withEnv({ GITLAB_TOKEN: undefined }, () =>
      Effect.gen(function* () {
        const fixture = yield* discoveryFixture
        discoverWorkflowModels.mockImplementation(() => new Promise(() => {}))
        yield* fixture.credentials.create({ integrationID, value: { type: "key", key: "hanging" } })
        yield* addPlugin()
        yield* drain
        expect(discoverWorkflowModels).toHaveBeenCalledTimes(1)
        yield* TestClock.adjust("10 seconds")
        yield* drain

        discoverWorkflowModels.mockResolvedValue(discovered)
        yield* fixture.credentials.create({ integrationID, value: { type: "key", key: "responsive" } })
        yield* drain
        expect(discoverWorkflowModels).toHaveBeenCalledTimes(2)
        expect(yield* fixture.models.get(providerID, Model.ID.make("duo-workflow-new-model"))).toBeDefined()
      }),
    ),
  )

  it.effect("skips unauthenticated discovery and refreshes after credential changes, including failures", () =>
    withEnv({ GITLAB_TOKEN: undefined }, () =>
      Effect.gen(function* () {
        const fixture = yield* discoveryFixture
        yield* addPlugin()
        yield* drain
        expect(discoverWorkflowModels).not.toHaveBeenCalled()

        discoverWorkflowModels.mockResolvedValue(discovered)
        yield* fixture.credentials.create({ integrationID, value: { type: "key", key: "first-token" } })
        yield* drain
        expect(yield* fixture.models.get(providerID, Model.ID.make("duo-workflow-new-model"))).toBeDefined()

        discoverWorkflowModels.mockRejectedValue(new Error("discovery unavailable"))
        const credential = yield* fixture.credentials.create({
          integrationID,
          value: { type: "key", key: "second-token" },
        })
        yield* drain
        expect(discoverWorkflowModels.mock.calls.at(-1)![0].getHeaders()).toEqual({ "PRIVATE-TOKEN": "second-token" })
        expect(yield* fixture.models.get(providerID, Model.ID.make("duo-workflow-new-model"))).toBeUndefined()
        expect(yield* fixture.models.get(providerID, Model.ID.make("duo-chat-sonnet-5"))).toBeDefined()

        discoverWorkflowModels.mockResolvedValue({ models: [discovered.models[1]!], project: null })
        const latest = yield* fixture.credentials.create({ integrationID, value: { type: "key", key: "third-token" } })
        yield* drain
        expect(yield* fixture.models.get(providerID, Model.ID.make("duo-workflow-default"))).toBeDefined()
        expect(yield* fixture.models.get(providerID, Model.ID.make("duo-workflow-new-model"))).toBeUndefined()

        discoverWorkflowModels.mockResolvedValue({ models: [], project: null })
        yield* fixture.credentials.activate(credential.id)
        yield* drain
        expect(yield* fixture.models.get(providerID, Model.ID.make("duo-workflow-default"))).toBeUndefined()
        yield* fixture.credentials.remove(latest.id)
      }),
    ),
  )

  it.effect("creates SDKs with legacy default instance URL, token env, headers, and feature flags", () =>
    withEnv(
      {
        GITLAB_INSTANCE_URL: undefined,
        GITLAB_TOKEN: "env-token",
      },
      () =>
        Effect.gen(function* () {
          gitlabSDKOptions.length = 0
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          yield* aisdk.runSDK({
            model: Model.Info.make({
              ...Model.Info.default(Provider.ID.make("gitlab"), Model.ID.make("claude")),
              modelID: Model.ID.make("claude"),
              package: "aisdk:test-provider",
            }),
            package: "gitlab-ai-provider",
            options: { name: "gitlab" },
          })
          expect(gitlabSDKOptions).toHaveLength(1)
          expect(gitlabSDKOptions[0].instanceUrl).toBe("https://gitlab.com")
          expect(gitlabSDKOptions[0].apiKey).toBe("env-token")
          expect(gitlabSDKOptions[0].aiGatewayHeaders).toMatchObject({
            "anthropic-beta": "context-1m-2025-08-07",
          })
          expect(String((gitlabSDKOptions[0].aiGatewayHeaders as Record<string, string>)["User-Agent"])).toContain(
            "gitlab-ai-provider/test-version",
          )
          expect(gitlabSDKOptions[0].featureFlags).toEqual({
            duo_agent_platform_agentic_chat: true,
            duo_agent_platform: true,
          })
        }),
    ),
  )

  it.effect("uses GITLAB_INSTANCE_URL when instanceUrl is not configured", () =>
    withEnv(
      {
        GITLAB_INSTANCE_URL: "https://env.gitlab.example",
        GITLAB_TOKEN: undefined,
      },
      () =>
        Effect.gen(function* () {
          gitlabSDKOptions.length = 0
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          yield* aisdk.runSDK({
            model: Model.Info.make({
              ...Model.Info.default(Provider.ID.make("gitlab"), Model.ID.make("claude")),
              modelID: Model.ID.make("claude"),
              package: "aisdk:test-provider",
            }),
            package: "gitlab-ai-provider",
            options: { name: "gitlab" },
          })
          expect(gitlabSDKOptions[0].instanceUrl).toBe("https://env.gitlab.example")
        }),
    ),
  )

  it.effect("keeps configured instance URL, apiKey, aiGatewayHeaders, and featureFlags over env/defaults", () =>
    withEnv(
      {
        GITLAB_INSTANCE_URL: "https://env.gitlab.example",
        GITLAB_TOKEN: "env-token",
      },
      () =>
        Effect.gen(function* () {
          gitlabSDKOptions.length = 0
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          yield* aisdk.runSDK({
            model: Model.Info.make({
              ...Model.Info.default(Provider.ID.make("gitlab"), Model.ID.make("claude")),
              modelID: Model.ID.make("claude"),
              package: "aisdk:test-provider",
            }),
            package: "gitlab-ai-provider",
            options: {
              name: "gitlab",
              instanceUrl: "https://configured.gitlab.example",
              apiKey: "configured-token",
              aiGatewayHeaders: {
                "anthropic-beta": "configured-beta",
                "x-gitlab-test": "1",
              },
              featureFlags: {
                duo_agent_platform: false,
                custom_flag: true,
              },
            },
          })
          expect(gitlabSDKOptions[0].instanceUrl).toBe("https://configured.gitlab.example")
          expect(gitlabSDKOptions[0].apiKey).toBe("configured-token")
          expect(gitlabSDKOptions[0].aiGatewayHeaders).toMatchObject({
            "anthropic-beta": "configured-beta",
            "x-gitlab-test": "1",
          })
          expect(gitlabSDKOptions[0].featureFlags).toEqual({
            duo_agent_platform_agentic_chat: true,
            duo_agent_platform: false,
            custom_flag: true,
          })
        }),
    ),
  )

  it.effect("ignores non-GitLab SDK packages", () =>
    Effect.gen(function* () {
      gitlabSDKOptions.length = 0
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("gitlab"), Model.ID.make("claude")),
          modelID: Model.ID.make("claude"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/openai",
        options: { name: "gitlab" },
      })
      expect(result.sdk).toBeUndefined()
      expect(gitlabSDKOptions).toHaveLength(0)
    }),
  )

  it.effect("uses workflowChat for duo workflow models and preserves selectedModelRef", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: [string, unknown][] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("gitlab"), Model.ID.make("duo-workflow-custom")),
          modelID: Model.ID.make("duo-workflow-custom"),
          package: "aisdk:test-provider",
          headers: {},
          settings: { workflowRef: "ref", workflowDefinition: "definition" },
        }),
        sdk: {
          workflowChat: (id: string, options: unknown) => {
            calls.push([id, options])
            return { id, options }
          },
          agenticChat: () => undefined,
        },
        options: { featureFlags: { configured: true } },
      })
      expect(calls).toEqual([
        ["duo-workflow", { featureFlags: { configured: true }, workflowDefinition: "definition" }],
      ])
      expect(result.language as unknown).toEqual({
        id: "duo-workflow",
        options: calls[0]?.[1],
        selectedModelRef: "ref",
      })
    }),
  )

  it.effect("uses exact static workflow model ids when the provider recognizes them", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: [string, unknown][] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("gitlab"), Model.ID.make("duo-workflow-exact")),
          modelID: Model.ID.make("duo-workflow-exact"),
          package: "aisdk:test-provider",
        }),
        sdk: {
          workflowChat: (id: string, options: unknown) => {
            calls.push([id, options])
            return { id, options }
          },
          agenticChat: () => undefined,
        },
        options: { featureFlags: { configured: true } },
      })
      expect(calls).toEqual([
        ["duo-workflow-exact", { featureFlags: { configured: true }, workflowDefinition: undefined }],
      ])
      expect(result.language as unknown).toEqual({ id: "duo-workflow-exact", options: calls[0]?.[1] })
    }),
  )

  it.effect("uses provider feature flags instead of model settings feature flags", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: [string, unknown][] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("gitlab"), Model.ID.make("duo-workflow-custom")),
          modelID: Model.ID.make("duo-workflow-custom"),
          package: "aisdk:test-provider",
          headers: {},
          settings: { featureFlags: { request_flag: true } },
        }),
        sdk: {
          workflowChat: (id: string, options: unknown) => {
            calls.push([id, options])
            return { id, options }
          },
          agenticChat: () => undefined,
        },
        options: { featureFlags: { configured: true } },
      })
      expect(calls).toEqual([["duo-workflow", { featureFlags: { configured: true }, workflowDefinition: undefined }]])
    }),
  )

  it.effect("uses agenticChat with provider aiGatewayHeaders and feature flags for normal models", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: [string, unknown][] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("gitlab"), Model.ID.make("claude")),
          modelID: Model.ID.make("claude"),
          package: "aisdk:test-provider",
          headers: { h: "v" },
          settings: {},
        }),
        sdk: {
          workflowChat: () => undefined,
          agenticChat: (id: string, options: unknown) => {
            const selected = options as {
              aiGatewayHeaders?: Record<string, string>
              featureFlags?: Record<string, boolean>
            }
            calls.push([
              id,
              { aiGatewayHeaders: { ...selected.aiGatewayHeaders }, featureFlags: { ...selected.featureFlags } },
            ])
          },
        },
        options: { aiGatewayHeaders: { fallback: "header" }, featureFlags: { duo_agent_platform: true } },
      })
      expect(calls).toEqual([
        ["claude", { aiGatewayHeaders: { fallback: "header" }, featureFlags: { duo_agent_platform: true } }],
      ])
    }),
  )
})
