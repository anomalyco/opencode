import { describe, expect, mock } from "bun:test"
import { Effect, Layer } from "effect"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Database } from "@opencode-ai/core/database/database"
import { Catalog } from "@opencode-ai/core/catalog"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { GitLabPlugin } from "@opencode-ai/core/plugin/provider/gitlab"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { it, model, npmLayer, withEnv } from "./provider-helper"

const gitlabSDKOptions: Record<string, unknown>[] = []
const database = Database.layerFromPath(":memory:").pipe(Layer.fresh)
const preferences = Credential.layer.pipe(Layer.provide(database))
const accounts = Layer.merge(
  Credential.layer.pipe(Layer.provide(database), Layer.provide(preferences), Layer.provide(EventV2.defaultLayer)),
  preferences,
)

void mock.module("gitlab-ai-provider", () => ({
  VERSION: "test-version",
  createGitLab: (options: Record<string, unknown>) => {
    gitlabSDKOptions.push(options)
    return {
      agenticChat: (id: string, options: unknown) => ({ id, options, type: "agentic" }),
      workflowChat: (id: string, options: unknown) => ({ id, options, type: "workflow" }),
    }
  },
  discoverWorkflowModels: async () => ({ models: [], project: undefined }),
  isWorkflowModel: (id: string) => id === "duo-workflow" || id === "duo-workflow-exact",
}))

const itWithAccount = testEffect(
  Catalog.locationLayer.pipe(
    Layer.provideMerge(accounts),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/") }))),
    ),
    Layer.provideMerge(npmLayer),
  ),
)

describe("GitLabPlugin", () => {
  it.effect("creates SDKs with legacy default instance URL, token env, headers, and feature flags", () =>
    withEnv(
      {
        GITLAB_INSTANCE_URL: undefined,
        GITLAB_TOKEN: "env-token",
      },
      () =>
        Effect.gen(function* () {
          gitlabSDKOptions.length = 0
          const plugin = yield* PluginV2.Service
          yield* plugin.add(GitLabPlugin)
          yield* plugin.trigger(
            "aisdk.sdk",
            { model: model("gitlab", "claude"), package: "gitlab-ai-provider", options: { name: "gitlab" } },
            {},
          )
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
          const plugin = yield* PluginV2.Service
          yield* plugin.add(GitLabPlugin)
          yield* plugin.trigger(
            "aisdk.sdk",
            { model: model("gitlab", "claude"), package: "gitlab-ai-provider", options: { name: "gitlab" } },
            {},
          )
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
          const plugin = yield* PluginV2.Service
          yield* plugin.add(GitLabPlugin)
          yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("gitlab", "claude"),
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
            },
            {},
          )
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
      const plugin = yield* PluginV2.Service
      yield* plugin.add(GitLabPlugin)
      const result = yield* plugin.trigger(
        "aisdk.sdk",
        { model: model("gitlab", "claude"), package: "@ai-sdk/openai", options: { name: "gitlab" } },
        {},
      )
      expect(result.sdk).toBeUndefined()
      expect(gitlabSDKOptions).toHaveLength(0)
    }),
  )

  itWithAccount.effect("uses active account API token over GITLAB_TOKEN", () =>
    withEnv(
      {
        GITLAB_TOKEN: "env-token",
      },
      () =>
        Effect.gen(function* () {
          gitlabSDKOptions.length = 0
          const plugin = yield* PluginV2.Service
          const credentials = yield* Credential.Service
          const catalog = yield* Catalog.Service
          yield* credentials.create({
            integrationID: Integration.ID.make("gitlab"),
            value: new Credential.Key({ type: "key", key: "account-token" }),
          })
          yield* plugin.add(GitLabPlugin)
          const transform = yield* catalog.transform()
          yield* transform((catalog) => catalog.provider.update(ProviderV2.ID.make("gitlab"), () => {}))
          const provider = yield* catalog.provider.get(ProviderV2.ID.make("gitlab"))
          yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("gitlab", "claude"),
              package: "gitlab-ai-provider",
              options: provider.request.body,
            },
            {},
          )
          expect(gitlabSDKOptions[0].apiKey).toBe("account-token")
        }),
    ),
  )

  itWithAccount.effect("uses active account OAuth access token when no API token exists", () =>
    withEnv(
      {
        GITLAB_TOKEN: undefined,
      },
      () =>
        Effect.gen(function* () {
          gitlabSDKOptions.length = 0
          const plugin = yield* PluginV2.Service
          const credentials = yield* Credential.Service
          const catalog = yield* Catalog.Service
          yield* credentials.create({
            integrationID: Integration.ID.make("gitlab"),
            value: new Credential.OAuth({
              type: "oauth",
              methodID: Integration.MethodID.make("oauth"),
              refresh: "refresh-token",
              access: "account-oauth-token",
              expires: 9999999999999,
            }),
          })
          yield* plugin.add(GitLabPlugin)
          const transform = yield* catalog.transform()
          yield* transform((catalog) => catalog.provider.update(ProviderV2.ID.make("gitlab"), () => {}))
          const provider = yield* catalog.provider.get(ProviderV2.ID.make("gitlab"))
          yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("gitlab", "claude"),
              package: "gitlab-ai-provider",
              options: provider.request.body,
            },
            {},
          )
          expect(gitlabSDKOptions[0].apiKey).toBe("account-oauth-token")
        }),
    ),
  )

  it.effect("uses workflowChat for duo workflow models and preserves selectedModelRef", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: [string, unknown][] = []
      yield* plugin.add(GitLabPlugin)
      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("gitlab", "duo-workflow-custom", {
            request: {
              headers: {},
              body: { workflowRef: "ref", workflowDefinition: "definition" },
            },
          }),
          sdk: {
            workflowChat: (id: string, options: unknown) => {
              calls.push([id, options])
              return { id, options }
            },
            agenticChat: () => undefined,
          },
          options: { featureFlags: { configured: true } },
        },
        {},
      )
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
      const plugin = yield* PluginV2.Service
      const calls: [string, unknown][] = []
      yield* plugin.add(GitLabPlugin)
      const result = yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("gitlab", "duo-workflow-exact"),
          sdk: {
            workflowChat: (id: string, options: unknown) => {
              calls.push([id, options])
              return { id, options }
            },
            agenticChat: () => undefined,
          },
          options: { featureFlags: { configured: true } },
        },
        {},
      )
      expect(calls).toEqual([
        ["duo-workflow-exact", { featureFlags: { configured: true }, workflowDefinition: undefined }],
      ])
      expect(result.language as unknown).toEqual({ id: "duo-workflow-exact", options: calls[0]?.[1] })
    }),
  )

  it.effect("uses provider feature flags instead of request feature flags", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: [string, unknown][] = []
      yield* plugin.add(GitLabPlugin)
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("gitlab", "duo-workflow-custom", {
            request: {
              headers: {},
              body: { featureFlags: { request_flag: true } },
            },
          }),
          sdk: {
            workflowChat: (id: string, options: unknown) => {
              calls.push([id, options])
              return { id, options }
            },
            agenticChat: () => undefined,
          },
          options: { featureFlags: { configured: true } },
        },
        {},
      )
      expect(calls).toEqual([["duo-workflow", { featureFlags: { configured: true }, workflowDefinition: undefined }]])
    }),
  )

  it.effect("uses agenticChat with provider aiGatewayHeaders and feature flags for normal models", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const calls: [string, unknown][] = []
      yield* plugin.add(GitLabPlugin)
      yield* plugin.trigger(
        "aisdk.language",
        {
          model: model("gitlab", "claude", {
            request: { headers: { h: "v" }, body: {} },
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
        },
        {},
      )
      expect(calls).toEqual([
        ["claude", { aiGatewayHeaders: { fallback: "header" }, featureFlags: { duo_agent_platform: true } }],
      ])
    }),
  )
})
