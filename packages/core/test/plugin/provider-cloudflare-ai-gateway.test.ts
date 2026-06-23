import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect, mock } from "bun:test"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { CloudflareAIGatewayPlugin } from "@opencode-ai/core/plugin/provider/cloudflare-ai-gateway"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* CloudflareAIGatewayPlugin.effect(host)
})

function withEnv<A, E, R>(vars: Record<string, string | undefined>, fx: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    fx,
    (previous) =>
      Effect.sync(() => {
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        })
      }),
  )
}

const aiGatewayCalls: Record<string, unknown>[] = []
const unifiedCalls: string[] = []
const gatewayModelCalls: unknown[] = []

function captureAiGatewayOptions(options: Record<string, unknown>) {
  const nested =
    options.options && typeof options.options === "object" ? (options.options as Record<string, unknown>) : undefined
  return {
    ...options,
    ...(nested
      ? {
          options: {
            ...nested,
            headers:
              nested.headers && typeof nested.headers === "object"
                ? { ...(nested.headers as Record<string, unknown>) }
                : nested.headers,
          },
        }
      : {}),
  }
}

function resetCalls() {
  aiGatewayCalls.length = 0
  unifiedCalls.length = 0
  gatewayModelCalls.length = 0
}

function cloudflareEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    CLOUDFLARE_ACCOUNT_ID: "env-account",
    CLOUDFLARE_GATEWAY_ID: "env-gateway",
    CLOUDFLARE_API_TOKEN: "env-token",
    CF_AIG_TOKEN: undefined,
    ...overrides,
  }
}

mock.module("ai-gateway-provider", () => ({
  createAiGateway(options: Record<string, unknown>) {
    aiGatewayCalls.push(captureAiGatewayOptions(options))
    return (input: unknown) => {
      gatewayModelCalls.push(input)
      return {
        modelId: input,
        provider: "cloudflare-ai-gateway",
        specificationVersion: "v3",
      }
    }
  },
}))

mock.module("ai-gateway-provider/providers/unified", () => ({
  createUnified() {
    return (modelID: string) => {
      unifiedCalls.push(modelID)
      return { unifiedModelID: modelID }
    }
  },
}))

describe("CloudflareAIGatewayPlugin", () => {
  it.effect("requires account, gateway, and token before creating the unified SDK", () =>
    withEnv(
      {
        CLOUDFLARE_ACCOUNT_ID: "acct",
        CLOUDFLARE_GATEWAY_ID: "gateway",
        CLOUDFLARE_API_TOKEN: "token",
        CF_AIG_TOKEN: undefined,
      },
      () =>
        Effect.gen(function* () {
          const plugin = yield* PluginV2.Service
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          const result = yield* aisdk.runSDK({
            model: new ModelV2.Info({
              ...ModelV2.Info.empty(ProviderV2.ID.make("cloudflare-ai-gateway"), ModelV2.ID.make("openai/gpt-5")),
              api: { id: ModelV2.ID.make("openai/gpt-5"), type: "aisdk", package: "test-provider" },
            }),
            package: "ai-gateway-provider",
            options: { name: "cloudflare-ai-gateway" },
          })
          expect(result.sdk.languageModel("openai/gpt-5")).toBeDefined()
        }),
    ),
  )

  it.effect("passes legacy metadata, cache, log, and User-Agent values under the AI Gateway options key", () =>
    withEnv(cloudflareEnv(), () =>
      Effect.gen(function* () {
        resetCalls()
        const plugin = yield* PluginV2.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()

        yield* aisdk.runSDK({
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("cloudflare-ai-gateway"), ModelV2.ID.make("openai/gpt-5")),
            api: { id: ModelV2.ID.make("openai/gpt-5"), type: "aisdk", package: "test-provider" },
          }),
          package: "ai-gateway-provider",
          options: {
            name: "cloudflare-ai-gateway",
            metadata: { invoked_by: "test", project: "opencode" },
            cacheTtl: 300,
            cacheKey: "cache-key",
            skipCache: true,
            collectLog: false,
          },
        })

        expect(aiGatewayCalls).toHaveLength(1)
        expect(aiGatewayCalls[0]).toEqual({
          accountId: "env-account",
          gateway: "env-gateway",
          apiKey: "env-token",
          options: {
            metadata: { invoked_by: "test", project: "opencode" },
            cacheTtl: 300,
            cacheKey: "cache-key",
            skipCache: true,
            collectLog: false,
            headers: {
              "User-Agent": expect.stringContaining("opencode/"),
            },
          },
        })
      }),
    ),
  )

  it.effect("parses legacy cf-aig-metadata header when metadata option is absent", () =>
    withEnv(cloudflareEnv(), () =>
      Effect.gen(function* () {
        resetCalls()
        const plugin = yield* PluginV2.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()

        yield* aisdk.runSDK({
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("cloudflare-ai-gateway"), ModelV2.ID.make("openai/gpt-5")),
            api: { id: ModelV2.ID.make("openai/gpt-5"), type: "aisdk", package: "test-provider" },
          }),
          package: "ai-gateway-provider",
          options: {
            name: "cloudflare-ai-gateway",
            headers: {
              "cf-aig-metadata": JSON.stringify({ invoked_by: "header", project: "opencode" }),
            },
          },
        })

        expect(aiGatewayCalls[0]?.options).toMatchObject({
          metadata: { invoked_by: "header", project: "opencode" },
        })
      }),
    ),
  )

  it.effect("prefers Cloudflare env values over auth/config-derived options", () =>
    withEnv(cloudflareEnv(), () =>
      Effect.gen(function* () {
        resetCalls()
        const plugin = yield* PluginV2.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()

        yield* aisdk.runSDK({
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("cloudflare-ai-gateway"), ModelV2.ID.make("openai/gpt-5")),
            api: { id: ModelV2.ID.make("openai/gpt-5"), type: "aisdk", package: "test-provider" },
          }),
          package: "ai-gateway-provider",
          options: {
            name: "cloudflare-ai-gateway",
            accountId: "auth-account",
            gateway: "auth-gateway",
            apiKey: "auth-token",
          },
        })

        expect(aiGatewayCalls[0]).toMatchObject({
          accountId: "env-account",
          gateway: "env-gateway",
          apiKey: "env-token",
        })
      }),
    ),
  )

  it.effect("accepts gatewayId metadata copied from auth into provider options", () =>
    withEnv(
      cloudflareEnv({
        CLOUDFLARE_ACCOUNT_ID: undefined,
        CLOUDFLARE_GATEWAY_ID: undefined,
        CLOUDFLARE_API_TOKEN: undefined,
      }),
      () =>
        Effect.gen(function* () {
          resetCalls()
          const plugin = yield* PluginV2.Service
          const aisdk = yield* AISDK.Service
          yield* addPlugin()

          yield* aisdk.runSDK({
            model: new ModelV2.Info({
              ...ModelV2.Info.empty(ProviderV2.ID.make("cloudflare-ai-gateway"), ModelV2.ID.make("openai/gpt-5")),
              api: { id: ModelV2.ID.make("openai/gpt-5"), type: "aisdk", package: "test-provider" },
            }),
            package: "ai-gateway-provider",
            options: {
              name: "cloudflare-ai-gateway",
              accountId: "auth-account",
              gatewayId: "auth-gateway",
              apiKey: "auth-token",
            },
          })

          expect(aiGatewayCalls[0]).toMatchObject({
            accountId: "auth-account",
            gateway: "auth-gateway",
            apiKey: "auth-token",
          })
        }),
    ),
  )

  it.effect("falls back to CF_AIG_TOKEN when CLOUDFLARE_API_TOKEN is unset", () =>
    withEnv(cloudflareEnv({ CLOUDFLARE_API_TOKEN: undefined, CF_AIG_TOKEN: "cf-aig-token" }), () =>
      Effect.gen(function* () {
        resetCalls()
        const plugin = yield* PluginV2.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()

        yield* aisdk.runSDK({
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("cloudflare-ai-gateway"), ModelV2.ID.make("openai/gpt-5")),
            api: { id: ModelV2.ID.make("openai/gpt-5"), type: "aisdk", package: "test-provider" },
          }),
          package: "ai-gateway-provider",
          options: { name: "cloudflare-ai-gateway" },
        })

        expect(aiGatewayCalls[0]).toMatchObject({ apiKey: "cf-aig-token" })
      }),
    ),
  )

  it.effect("does not create an SDK when account and gateway IDs are missing", () =>
    withEnv(cloudflareEnv({ CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_GATEWAY_ID: undefined }), () =>
      Effect.gen(function* () {
        resetCalls()
        const plugin = yield* PluginV2.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()

        const result = yield* aisdk.runSDK({
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("cloudflare-ai-gateway"), ModelV2.ID.make("openai/gpt-5")),
            api: { id: ModelV2.ID.make("openai/gpt-5"), type: "aisdk", package: "test-provider" },
          }),
          package: "ai-gateway-provider",
          options: { name: "cloudflare-ai-gateway" },
        })

        expect(result.sdk).toBeUndefined()
        expect(aiGatewayCalls).toHaveLength(0)
      }),
    ),
  )

  it.effect("does not create an SDK when the token is missing", () =>
    withEnv(cloudflareEnv({ CLOUDFLARE_API_TOKEN: undefined, CF_AIG_TOKEN: undefined }), () =>
      Effect.gen(function* () {
        resetCalls()
        const plugin = yield* PluginV2.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()

        const result = yield* aisdk.runSDK({
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("cloudflare-ai-gateway"), ModelV2.ID.make("openai/gpt-5")),
            api: { id: ModelV2.ID.make("openai/gpt-5"), type: "aisdk", package: "test-provider" },
          }),
          package: "ai-gateway-provider",
          options: { name: "cloudflare-ai-gateway" },
        })

        expect(result.sdk).toBeUndefined()
        expect(aiGatewayCalls).toHaveLength(0)
      }),
    ),
  )

  it.effect("does not replace a configured baseURL with the Cloudflare AI Gateway SDK", () =>
    withEnv(
      cloudflareEnv({
        CLOUDFLARE_ACCOUNT_ID: undefined,
        CLOUDFLARE_GATEWAY_ID: undefined,
        CLOUDFLARE_API_TOKEN: undefined,
      }),
      () =>
        Effect.gen(function* () {
          resetCalls()
          const plugin = yield* PluginV2.Service
          const aisdk = yield* AISDK.Service
          yield* addPlugin()

          const result = yield* aisdk.runSDK({
            model: new ModelV2.Info({
              ...ModelV2.Info.empty(ProviderV2.ID.make("cloudflare-ai-gateway"), ModelV2.ID.make("openai/gpt-5")),
              api: { id: ModelV2.ID.make("openai/gpt-5"), type: "aisdk", package: "test-provider" },
            }),
            package: "ai-gateway-provider",
            options: { name: "cloudflare-ai-gateway", baseURL: "https://proxy.example/v1" },
          })

          expect(result.sdk).toBeUndefined()
          expect(aiGatewayCalls).toHaveLength(0)
        }),
    ),
  )

  it.effect("maps provider/model IDs through the unified Cloudflare provider unchanged", () =>
    withEnv(cloudflareEnv(), () =>
      Effect.gen(function* () {
        resetCalls()
        const plugin = yield* PluginV2.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()

        const result = yield* aisdk.runSDK({
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(
              ProviderV2.ID.make("cloudflare-ai-gateway"),
              ModelV2.ID.make("anthropic/claude-sonnet-4-5"),
            ),
            api: {
              id: ModelV2.ID.make("anthropic/claude-sonnet-4-5"),
              type: "aisdk",
              package: "test-provider",
            },
          }),
          package: "ai-gateway-provider",
          options: { name: "cloudflare-ai-gateway" },
        })

        expect(result.sdk.languageModel("anthropic/claude-sonnet-4-5")).toEqual({
          modelId: { unifiedModelID: "anthropic/claude-sonnet-4-5" },
          provider: "cloudflare-ai-gateway",
          specificationVersion: "v3",
        })
        expect(unifiedCalls).toEqual(["anthropic/claude-sonnet-4-5"])
        expect(gatewayModelCalls).toEqual([{ unifiedModelID: "anthropic/claude-sonnet-4-5" }])
      }),
    ),
  )

  it.effect("ignores non Cloudflare AI Gateway packages", () =>
    withEnv(cloudflareEnv(), () =>
      Effect.gen(function* () {
        resetCalls()
        const plugin = yield* PluginV2.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()

        const result = yield* aisdk.runSDK({
          model: new ModelV2.Info({
            ...ModelV2.Info.empty(ProviderV2.ID.make("cloudflare-ai-gateway"), ModelV2.ID.make("openai/gpt-5")),
            api: { id: ModelV2.ID.make("openai/gpt-5"), type: "aisdk", package: "test-provider" },
          }),
          package: "@ai-sdk/openai-compatible",
          options: { name: "cloudflare-ai-gateway" },
        })

        expect(result.sdk).toBeUndefined()
        expect(aiGatewayCalls).toHaveLength(0)
      }),
    ),
  )
})
