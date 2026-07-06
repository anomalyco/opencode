import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { GitLabPlugin } from "@opencode-ai/core/plugin/provider/gitlab"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const gitlabSDKOptions: Record<string, unknown>[] = []
const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* GitLabPlugin.effect(host)
})

function withEnv<A, E, R>(vars: Record<string, string | undefined>, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() =>
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }),
      ),
  )
}

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
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          yield* aisdk.runSDK({
            model: ModelV2.Info.make({
              ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("claude")),
              modelID: ModelV2.ID.make("claude"),
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
          const plugin = yield* PluginV2.Service
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          yield* aisdk.runSDK({
            model: ModelV2.Info.make({
              ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("claude")),
              modelID: ModelV2.ID.make("claude"),
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
          const plugin = yield* PluginV2.Service
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          yield* aisdk.runSDK({
            model: ModelV2.Info.make({
              ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("claude")),
              modelID: ModelV2.ID.make("claude"),
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
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("claude")),
          modelID: ModelV2.ID.make("claude"),
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
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: [string, unknown][] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("duo-workflow-custom")),
          modelID: ModelV2.ID.make("duo-workflow-custom"),
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
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: [string, unknown][] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("duo-workflow-exact")),
          modelID: ModelV2.ID.make("duo-workflow-exact"),
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
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: [string, unknown][] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("duo-workflow-custom")),
          modelID: ModelV2.ID.make("duo-workflow-custom"),
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
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: [string, unknown][] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("gitlab"), ModelV2.ID.make("claude")),
          modelID: ModelV2.ID.make("claude"),
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
