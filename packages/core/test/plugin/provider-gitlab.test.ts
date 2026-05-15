import { describe, expect, mock } from "bun:test"
import { Effect, Layer } from "effect"
import { AuthV2 } from "@opencode-ai/core/auth"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { AuthPlugin } from "@opencode-ai/core/plugin/auth"
import { GitLabPlugin } from "@opencode-ai/core/plugin/provider/gitlab"
import { testEffect } from "../lib/effect"
import { it, model, npmLayer, provider, withEnv } from "./provider-helper"

const gitlabSDKOptions: Record<string, unknown>[] = []

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

const itWithAuth = testEffect(Layer.mergeAll(PluginV2.defaultLayer, AuthV2.defaultLayer, npmLayer))

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

  itWithAuth.effect("uses active API auth token over GITLAB_TOKEN", () =>
    withEnv(
      {
        GITLAB_TOKEN: "env-token",
      },
      () =>
        Effect.gen(function* () {
          gitlabSDKOptions.length = 0
          const plugin = yield* PluginV2.Service
          const auth = yield* AuthV2.Service
          yield* auth.create({
            serviceID: AuthV2.ServiceID.make("gitlab"),
            credential: new AuthV2.ApiKeyCredential({ type: "api", key: "auth-token" }),
            active: true,
          })
          yield* plugin.add({
            ...AuthPlugin,
            effect: AuthPlugin.effect.pipe(Effect.provideService(AuthV2.Service, auth)),
          })
          yield* plugin.add(GitLabPlugin)
          const updated = yield* plugin.trigger("provider.update", {}, { provider: provider("gitlab"), cancel: false })
          yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("gitlab", "claude"),
              package: "gitlab-ai-provider",
              options: updated.provider.options.aisdk.provider,
            },
            {},
          )
          expect(gitlabSDKOptions[0].apiKey).toBe("auth-token")
        }),
    ),
  )

  itWithAuth.effect("uses active OAuth access token when no API auth exists", () =>
    withEnv(
      {
        GITLAB_TOKEN: undefined,
      },
      () =>
        Effect.gen(function* () {
          gitlabSDKOptions.length = 0
          const plugin = yield* PluginV2.Service
          const auth = yield* AuthV2.Service
          yield* auth.create({
            serviceID: AuthV2.ServiceID.make("gitlab"),
            credential: new AuthV2.OAuthCredential({
              type: "oauth",
              refresh: "refresh-token",
              access: "oauth-token",
              expires: 9999999999999,
            }),
            active: true,
          })
          yield* plugin.add({
            ...AuthPlugin,
            effect: AuthPlugin.effect.pipe(Effect.provideService(AuthV2.Service, auth)),
          })
          yield* plugin.add(GitLabPlugin)
          const updated = yield* plugin.trigger("provider.update", {}, { provider: provider("gitlab"), cancel: false })
          yield* plugin.trigger(
            "aisdk.sdk",
            {
              model: model("gitlab", "claude"),
              package: "gitlab-ai-provider",
              options: updated.provider.options.aisdk.provider,
            },
            {},
          )
          expect(gitlabSDKOptions[0].apiKey).toBe("oauth-token")
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
            options: {
              headers: {},
              body: {},
              aisdk: { provider: {}, request: { workflowRef: "ref", workflowDefinition: "definition" } },
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
            options: {
              headers: {},
              body: {},
              aisdk: { provider: {}, request: { featureFlags: { request_flag: true } } },
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
            options: { headers: { h: "v" }, body: {}, aisdk: { provider: {}, request: {} } },
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
