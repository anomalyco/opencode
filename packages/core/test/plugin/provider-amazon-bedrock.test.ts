import { AISDK } from "@opencode-ai/core/aisdk"
import { LLM } from "@opencode-ai/ai"
import { describe, expect } from "bun:test"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { Model } from "@opencode-ai/core/model"
import { ModelResolver } from "@opencode-ai/core/model-resolver"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { AmazonBedrockPlugin } from "@opencode-ai/core/plugin/provider/amazon-bedrock"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { Headers } from "effect/unstable/http"

const it = testEffect(PluginTestLayer)

const bedrockIntegrationID = Integration.ID.make(Provider.ID.amazonBedrock)

const registerBedrock = (catalog: Catalog.Interface) =>
  catalog.transform((draft) =>
    draft.provider.update(Provider.ID.amazonBedrock, (provider) => {
      provider.package = Provider.aisdk("@ai-sdk/amazon-bedrock")
      provider.integrationID = bedrockIntegrationID
    }),
  )

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* AmazonBedrockPlugin.effect(host)
})

const bedrockModel = (settings: Model.Info["settings"]) =>
  Model.Info.make({
    ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5-v1:0")),
    package: Provider.aisdk("@ai-sdk/amazon-bedrock"),
    settings,
  })

const resolveBedrock = Effect.fn(function* (settings: Model.Info["settings"], credential?: Credential.Value) {
  const hooks = yield* PluginHooks.Service
  return yield* ModelResolver.fromCatalogModel(bedrockModel(settings), credential, {
    prepareProvider: (event) => hooks.trigger("provider", "model.prepare", event),
  })
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

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

function bedrockBaseURL(sdk: unknown, modelID = "anthropic.claude-sonnet-4-5") {
  const language = (sdk as { languageModel: (id: string) => unknown }).languageModel(modelID)
  return (language as { config: { baseUrl: () => string } }).config.baseUrl()
}

function bedrockFetch(sdk: unknown, modelID = "anthropic.claude-sonnet-4-5") {
  const language = (sdk as { languageModel: (id: string) => unknown }).languageModel(modelID)
  return (
    language as { config: { fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response> } }
  ).config.fetch
}

function openAIUrl(language: unknown, path: string, modelId: string) {
  return (language as { config: { url: (input: { path: string; modelId: string }) => string } }).config.url({
    path,
    modelId,
  })
}

describe("AmazonBedrockPlugin", () => {
  it.effect("moves endpoint setting to baseURL", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        const bedrock = Provider.Info.make({
          ...Provider.Info.empty(Provider.ID.amazonBedrock),
          package: Provider.aisdk("@ai-sdk/amazon-bedrock"),
          settings: { endpoint: "https://bedrock.example" },
        })
        catalog.provider.update(bedrock.id, (item) => {
          item.package = bedrock.package
          item.settings = { endpoint: "https://bedrock.example" }
        })
      })
      yield* addPlugin()
      const result = required(yield* catalog.provider.get(Provider.ID.amazonBedrock))
      expect(result.package).toBe(Provider.aisdk("@ai-sdk/amazon-bedrock"))
      expect(result.settings).toEqual({ baseURL: "https://bedrock.example" })
    }),
  )

  it.effect("enables providers configured with an AWS profile", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* registerBedrock(catalog)
      yield* catalog.transform((draft) =>
        draft.provider.update(Provider.ID.amazonBedrock, (provider) => {
          provider.settings = { profile: "opencode" }
        }),
      )
      expect(yield* catalog.provider.available()).toEqual([])

      yield* addPlugin()

      expect((yield* catalog.provider.available()).map((provider) => provider.id)).toContain(Provider.ID.amazonBedrock)
    }),
  )

  it.effect("detects a default shared-credentials profile without AWS_PROFILE", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const integrations = yield* Integration.Service
      const location = yield* Location.Service
      const credentialsFile = `${location.directory}/aws-default-credentials`
      yield* Effect.promise(() =>
        Bun.write(
          credentialsFile,
          "[default]\naws_access_key_id = AKIADEFAULT\naws_secret_access_key = default-secret\n",
        ),
      )

      yield* withEnv(
        {
          AWS_ACCESS_KEY_ID: undefined,
          AWS_BEARER_TOKEN_BEDROCK: undefined,
          AWS_EC2_METADATA_DISABLED: "true",
          AWS_PROFILE: undefined,
          AWS_SECRET_ACCESS_KEY: undefined,
          AWS_SESSION_TOKEN: undefined,
          AWS_SHARED_CREDENTIALS_FILE: credentialsFile,
        },
        () =>
          Effect.gen(function* () {
            yield* registerBedrock(catalog)
            yield* addPlugin()

            expect((yield* catalog.provider.available()).map((provider) => provider.id)).toContain(
              Provider.ID.amazonBedrock,
            )
            expect(yield* integrations.connection.active(bedrockIntegrationID)).toBeUndefined()
          }),
      )
    }),
  )

  it.effect("recovers availability when a missing AWS profile becomes valid", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const location = yield* Location.Service
      const profile = "opencode-late-profile"
      const credentialsFile = `${location.directory}/aws-late-credentials`
      yield* Effect.promise(() =>
        Bun.write(credentialsFile, "[other]\naws_access_key_id = OTHER\naws_secret_access_key = other\n"),
      )

      yield* withEnv(
        {
          AWS_ACCESS_KEY_ID: undefined,
          AWS_BEARER_TOKEN_BEDROCK: undefined,
          AWS_EC2_METADATA_DISABLED: "true",
          AWS_PROFILE: profile,
          AWS_SECRET_ACCESS_KEY: undefined,
          AWS_SHARED_CREDENTIALS_FILE: credentialsFile,
        },
        () =>
          Effect.gen(function* () {
            yield* registerBedrock(catalog)
            yield* addPlugin()
            expect(yield* catalog.provider.available()).toEqual([])

            yield* Effect.promise(() =>
              Bun.write(
                credentialsFile,
                `[${profile}]\naws_access_key_id = AKIALATE\naws_secret_access_key = late-secret\n`,
              ),
            )

            expect((yield* catalog.provider.available()).map((provider) => provider.id)).toContain(
              Provider.ID.amazonBedrock,
            )
          }),
      )
    }),
  )

  it.effect("prepares native SigV4 credentials from a configured AWS profile", () =>
    Effect.gen(function* () {
      const location = yield* Location.Service
      const profile = "opencode-provider-hook-test"
      const credentialsFile = `${location.directory}/aws-credentials`
      yield* Effect.promise(() =>
        Bun.write(
          credentialsFile,
          `[${profile}]\naws_access_key_id = AKIAEXAMPLE\naws_secret_access_key = secret\naws_session_token = session\n`,
        ),
      )

      yield* withEnv(
        {
          AWS_ACCESS_KEY_ID: undefined,
          AWS_BEARER_TOKEN_BEDROCK: undefined,
          AWS_EC2_METADATA_DISABLED: "true",
          AWS_PROFILE: undefined,
          AWS_REGION: undefined,
          AWS_SECRET_ACCESS_KEY: undefined,
          AWS_SESSION_TOKEN: undefined,
          AWS_SHARED_CREDENTIALS_FILE: credentialsFile,
        },
        () =>
          Effect.gen(function* () {
            yield* addPlugin()
            const resolved = yield* resolveBedrock(
              { profile, region: "eu-west-1" },
              Credential.Key.make({ type: "key", key: "ignored-bearer" }),
            )
            const headers = yield* resolved.route.auth.apply({
              request: LLM.request({ model: resolved, prompt: "Hello" }),
              method: "POST",
              url: "https://bedrock-runtime.eu-west-1.amazonaws.com/model/anthropic.claude-sonnet-4-5-v1:0/converse-stream",
              body: "{}",
              headers: Headers.empty,
            })

            expect(resolved.route.endpoint.baseURL).toBe("https://bedrock-runtime.eu-west-1.amazonaws.com")
            expect(headers.authorization).toContain("AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/")
            expect(headers.authorization).toContain("/eu-west-1/bedrock/aws4_request")
            expect(headers["x-amz-security-token"]).toBe("session")
          }),
      )
    }),
  )

  it.effect("keeps explicit Bedrock credentials and API keys ahead of the AWS chain", () =>
    withEnv({ AWS_PROFILE: undefined }, () =>
      Effect.gen(function* () {
        yield* addPlugin()
        const configured = yield* resolveBedrock({
          profile: "ignored",
          region: "us-east-1",
          credentials: { accessKeyId: "AKIASTATIC", secretAccessKey: "secret" },
        })
        const bearer = yield* resolveBedrock(
          { region: "us-east-1" },
          Credential.Key.make({ type: "key", key: "bedrock-api-key" }),
        )
        const url =
          "https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-sonnet-4-5-v1:0/converse-stream"
        const sign = (resolved: typeof configured) =>
          resolved.route.auth.apply({
            request: LLM.request({ model: resolved, prompt: "Hello" }),
            method: "POST",
            url,
            body: "{}",
            headers: Headers.empty,
          })

        expect((yield* sign(configured)).authorization).toContain("AWS4-HMAC-SHA256 Credential=AKIASTATIC/")
        expect((yield* sign(bearer)).authorization).toBe("Bearer bedrock-api-key")
      }),
    ),
  )

  it.effect("preserves region templates until configured provider settings are merged", () =>
    withEnv({ AWS_REGION: undefined }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.amazonBedrock, (item) => {
            item.package = Provider.aisdk("@ai-sdk/amazon-bedrock")
            item.settings = { baseURL: "https://bedrock.${AWS_REGION}.amazonaws.com" }
          })
          catalog.model.update(Provider.ID.amazonBedrock, Model.ID.make("openai.gpt-5.6-sol"), (item) => {
            item.package = Provider.aisdk("@ai-sdk/amazon-bedrock/mantle")
            item.settings = { baseURL: "https://bedrock-mantle.${AWS_REGION}.api.aws/openai/v1" }
          })
        })
        yield* addPlugin()
        const modelID = Model.ID.make("openai.gpt-5.6-sol")
        expect((yield* catalog.model.get(Provider.ID.amazonBedrock, modelID))?.settings?.baseURL).toBe(
          "https://bedrock-mantle.${AWS_REGION}.api.aws/openai/v1",
        )

        // ConfigProviderPlugin runs after provider plugins and applies the configured region.
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.amazonBedrock, (item) => {
            item.settings = Provider.mergeOverlay(item.settings, { region: "eu-west-1" })
          })
        })
        const configured = required(yield* catalog.model.get(Provider.ID.amazonBedrock, modelID))
        const resolved = yield* ModelResolver.fromCatalogModel(configured)

        expect(resolved.route.endpoint.baseURL).toBe("https://bedrock-mantle.eu-west-1.api.aws/openai/v1")
      }),
    ),
  )

  it.effect("prefers endpoint over baseURL for SDK base URL", () =>
    withEnv({ AWS_BEARER_TOKEN_BEDROCK: undefined, AWS_PROFILE: undefined, AWS_ACCESS_KEY_ID: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
            modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
            package: Provider.aisdk("test-provider"),
          }),
          package: "@ai-sdk/amazon-bedrock",
          options: {
            name: "amazon-bedrock",
            bearerToken: "token",
            baseURL: "https://base.example",
            endpoint: "https://endpoint.example",
            region: "us-east-1",
          },
        })
        expect(bedrockBaseURL(result.sdk)).toBe("https://endpoint.example")
      }),
    ),
  )

  it.effect("uses baseURL as SDK base URL", () =>
    withEnv({ AWS_BEARER_TOKEN_BEDROCK: undefined, AWS_PROFILE: undefined, AWS_ACCESS_KEY_ID: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
            modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
            package: Provider.aisdk("test-provider"),
          }),
          package: "@ai-sdk/amazon-bedrock",
          options: {
            name: "amazon-bedrock",
            bearerToken: "token",
            baseURL: "https://base.example",
            region: "us-east-1",
          },
        })
        expect(bedrockBaseURL(result.sdk)).toBe("https://base.example")
      }),
    ),
  )

  it.effect("creates SDK without explicit credential env so the default AWS chain can resolve credentials", () =>
    withEnv(
      {
        AWS_ACCESS_KEY_ID: undefined,
        AWS_BEARER_TOKEN_BEDROCK: undefined,
        AWS_CONTAINER_CREDENTIALS_FULL_URI: undefined,
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: undefined,
        AWS_PROFILE: undefined,
        AWS_REGION: undefined,
        AWS_WEB_IDENTITY_TOKEN_FILE: undefined,
      },
      () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const aisdk = yield* AISDK.Service
          yield* addPlugin()
          const result = yield* aisdk.runSDK({
            model: Model.Info.make({
              ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
              modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
              package: Provider.aisdk("test-provider"),
            }),
            package: "@ai-sdk/amazon-bedrock",
            options: { name: "amazon-bedrock" },
          })
          expect(result.sdk).toBeDefined()
          expect(bedrockBaseURL(result.sdk)).toBe("https://bedrock-runtime.us-east-1.amazonaws.com")
        }),
    ),
  )

  it.effect("uses config region over AWS_REGION for SDK base URL", () =>
    withEnv({ AWS_BEARER_TOKEN_BEDROCK: "token", AWS_REGION: "us-east-1" }, () =>
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
            modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
            package: Provider.aisdk("test-provider"),
          }),
          package: "@ai-sdk/amazon-bedrock",
          options: { name: "amazon-bedrock", region: "eu-west-1" },
        })
        expect(bedrockBaseURL(result.sdk)).toBe("https://bedrock-runtime.eu-west-1.amazonaws.com")
      }),
    ),
  )

  it.effect("uses AWS_REGION for SDK base URL when config region is absent", () =>
    withEnv({ AWS_BEARER_TOKEN_BEDROCK: "token", AWS_REGION: "eu-west-1" }, () =>
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
            modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
            package: Provider.aisdk("test-provider"),
          }),
          package: "@ai-sdk/amazon-bedrock",
          options: { name: "amazon-bedrock" },
        })
        expect(bedrockBaseURL(result.sdk)).toBe("https://bedrock-runtime.eu-west-1.amazonaws.com")
      }),
    ),
  )

  it.effect("defaults SDK region to us-east-1", () =>
    withEnv({ AWS_BEARER_TOKEN_BEDROCK: "token", AWS_REGION: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
            modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
            package: Provider.aisdk("test-provider"),
          }),
          package: "@ai-sdk/amazon-bedrock",
          options: { name: "amazon-bedrock" },
        })
        expect(bedrockBaseURL(result.sdk)).toBe("https://bedrock-runtime.us-east-1.amazonaws.com")
      }),
    ),
  )

  it.effect("loads bearer token option into env and uses bearer auth", () =>
    withEnv({ AWS_ACCESS_KEY_ID: undefined, AWS_BEARER_TOKEN_BEDROCK: undefined, AWS_PROFILE: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const aisdk = yield* AISDK.Service
        const headers: Array<string | null> = []
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
            modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
            package: Provider.aisdk("test-provider"),
          }),
          package: "@ai-sdk/amazon-bedrock",
          options: {
            name: "amazon-bedrock",
            bearerToken: "option-token",
            fetch: async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
              headers.push(new globalThis.Headers(init?.headers).get("Authorization"))
              return new Response("{}")
            },
          },
        })
        yield* Effect.promise(() => bedrockFetch(result.sdk)("https://bedrock.example", { method: "POST" }))
        expect(process.env.AWS_BEARER_TOKEN_BEDROCK).toBe("option-token")
        expect(headers).toEqual(["Bearer option-token"])
      }),
    ),
  )

  it.effect("prefers bearer token env over bearer token option", () =>
    withEnv({ AWS_BEARER_TOKEN_BEDROCK: "env-token" }, () =>
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const aisdk = yield* AISDK.Service
        const headers: Array<string | null> = []
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
            modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
            package: Provider.aisdk("test-provider"),
          }),
          package: "@ai-sdk/amazon-bedrock",
          options: {
            name: "amazon-bedrock",
            bearerToken: "option-token",
            fetch: async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
              headers.push(new globalThis.Headers(init?.headers).get("Authorization"))
              return new Response("{}")
            },
          },
        })
        yield* Effect.promise(() => bedrockFetch(result.sdk)("https://bedrock.example", { method: "POST" }))
        expect(process.env.AWS_BEARER_TOKEN_BEDROCK).toBe("env-token")
        expect(headers).toEqual(["Bearer env-token"])
      }),
    ),
  )

  it.effect("creates Mantle SDK with GPT-5 OpenAI base path", () =>
    withEnv({ AWS_BEARER_TOKEN_BEDROCK: undefined, AWS_PROFILE: undefined, AWS_ACCESS_KEY_ID: undefined }, () =>
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const aisdk = yield* AISDK.Service
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("openai.gpt-5.5")),
            modelID: Model.ID.make("openai.gpt-5.5"),
            package: Provider.aisdk("@ai-sdk/amazon-bedrock/mantle"),
          }),
          package: "@ai-sdk/amazon-bedrock/mantle",
          options: {
            name: "amazon-bedrock",
            bearerToken: "token",
            baseURL: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
            region: "us-east-2",
          },
        })
        const language = result.sdk.responses("openai.gpt-5.5")
        expect(openAIUrl(language, "/responses", "openai.gpt-5.5")).toBe(
          "https://bedrock-mantle.us-east-2.api.aws/openai/v1/responses",
        )
      }),
    ),
  )

  it.effect("selects Mantle APIs without Bedrock cross-region prefixes", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("openai.gpt-5.5")),
          modelID: Model.ID.make("openai.gpt-5.5"),
          package: Provider.aisdk("@ai-sdk/amazon-bedrock/mantle"),
        }),
        sdk: fakeSelectorSdk(calls),
        options: { baseURL: "https://bedrock-mantle.us-east-2.api.aws/openai/v1", region: "us-east-2" },
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("openai.gpt-oss-safeguard-120b")),
          modelID: Model.ID.make("openai.gpt-oss-safeguard-120b"),
          package: Provider.aisdk("@ai-sdk/amazon-bedrock/mantle"),
        }),
        sdk: fakeSelectorSdk(calls),
        options: { region: "us-east-1" },
      })
      expect(calls).toEqual(["responses:openai.gpt-5.5", "chat:openai.gpt-oss-safeguard-120b"])
    }),
  )

  it.effect("ignores other Bedrock provider subpaths", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
          modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
          package: Provider.aisdk("@ai-sdk/amazon-bedrock/anthropic"),
        }),
        package: "@ai-sdk/amazon-bedrock/anthropic",
        options: { name: "amazon-bedrock" },
      })
      expect(result.sdk).toBeUndefined()
    }),
  )

  it.effect("uses SigV4 credential env when bearer token is absent", () =>
    withEnv(
      {
        AWS_ACCESS_KEY_ID: "test-access-key",
        AWS_BEARER_TOKEN_BEDROCK: undefined,
        AWS_REGION: "us-east-1",
        AWS_SECRET_ACCESS_KEY: "test-secret-key",
        AWS_SESSION_TOKEN: "test-session-token",
      },
      () =>
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const aisdk = yield* AISDK.Service
          const headers: Array<string | null> = []
          yield* addPlugin()
          const result = yield* aisdk.runSDK({
            model: Model.Info.make({
              ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
              modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
              package: Provider.aisdk("test-provider"),
            }),
            package: "@ai-sdk/amazon-bedrock",
            options: {
              name: "amazon-bedrock",
              fetch: async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
                headers.push(new globalThis.Headers(init?.headers).get("Authorization"))
                return new Response("{}")
              },
            },
          })
          yield* Effect.promise(() =>
            bedrockFetch(result.sdk)("https://bedrock-runtime.us-east-1.amazonaws.com/model/test/invoke", {
              body: "{}",
              method: "POST",
            }),
          )
          expect(headers[0]?.startsWith("AWS4-HMAC-SHA256 ")).toBe(true)
        }),
    ),
  )

  it.effect("applies legacy cross-region inference prefixes", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
          modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
          modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: { region: "eu-west-1" },
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("global.anthropic.claude-sonnet-4-5")),
          modelID: Model.ID.make("global.anthropic.claude-sonnet-4-5"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: { region: "eu-west-1" },
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
          modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: { region: "ap-northeast-1" },
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
          modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: { region: "ap-southeast-2" },
      })
      expect(calls).toEqual([
        "languageModel:us.anthropic.claude-sonnet-4-5",
        "languageModel:eu.anthropic.claude-sonnet-4-5",
        "languageModel:global.anthropic.claude-sonnet-4-5",
        "languageModel:jp.anthropic.claude-sonnet-4-5",
        "languageModel:au.anthropic.claude-sonnet-4-5",
      ])
    }),
  )

  it.effect("uses AWS_REGION for language prefixes when region option is absent", () =>
    withEnv({ AWS_REGION: "eu-west-1" }, () =>
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        const aisdk = yield* AISDK.Service
        const calls: string[] = []
        yield* addPlugin()
        yield* aisdk.runLanguage({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make("anthropic.claude-sonnet-4-5")),
            modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
            package: Provider.aisdk("test-provider"),
          }),
          sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
          options: {},
        })
        expect(calls).toEqual(["languageModel:eu.anthropic.claude-sonnet-4-5"])
      }),
    ),
  )

  it.effect("applies the full legacy cross-region prefix matrix", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      const cases = [
        { region: "us-east-1", modelID: "amazon.nova-micro-v1:0", expected: "us.amazon.nova-micro-v1:0" },
        { region: "us-east-1", modelID: "amazon.nova-lite-v1:0", expected: "us.amazon.nova-lite-v1:0" },
        { region: "us-east-1", modelID: "amazon.nova-pro-v1:0", expected: "us.amazon.nova-pro-v1:0" },
        { region: "us-east-1", modelID: "amazon.nova-premier-v1:0", expected: "us.amazon.nova-premier-v1:0" },
        { region: "us-east-1", modelID: "amazon.nova-2-lite-v1:0", expected: "us.amazon.nova-2-lite-v1:0" },
        { region: "us-east-1", modelID: "anthropic.claude-sonnet-4-5", expected: "us.anthropic.claude-sonnet-4-5" },
        { region: "us-east-1", modelID: "deepseek.r1-v1:0", expected: "us.deepseek.r1-v1:0" },
        { region: "us-gov-west-1", modelID: "anthropic.claude-sonnet-4-5", expected: "anthropic.claude-sonnet-4-5" },
        { region: "us-east-1", modelID: "cohere.command-r-plus-v1:0", expected: "cohere.command-r-plus-v1:0" },
        { region: "eu-west-1", modelID: "anthropic.claude-sonnet-4-5", expected: "eu.anthropic.claude-sonnet-4-5" },
        { region: "eu-west-2", modelID: "amazon.nova-lite-v1:0", expected: "eu.amazon.nova-lite-v1:0" },
        { region: "eu-west-3", modelID: "amazon.nova-micro-v1:0", expected: "eu.amazon.nova-micro-v1:0" },
        {
          region: "eu-north-1",
          modelID: "meta.llama3-70b-instruct-v1:0",
          expected: "eu.meta.llama3-70b-instruct-v1:0",
        },
        { region: "eu-central-1", modelID: "mistral.pixtral-large-v1:0", expected: "eu.mistral.pixtral-large-v1:0" },
        { region: "eu-south-1", modelID: "anthropic.claude-sonnet-4-5", expected: "eu.anthropic.claude-sonnet-4-5" },
        { region: "eu-south-2", modelID: "anthropic.claude-sonnet-4-5", expected: "eu.anthropic.claude-sonnet-4-5" },
        { region: "eu-central-2", modelID: "anthropic.claude-sonnet-4-5", expected: "anthropic.claude-sonnet-4-5" },
        { region: "eu-west-1", modelID: "cohere.command-r-plus-v1:0", expected: "cohere.command-r-plus-v1:0" },
        {
          region: "ap-southeast-2",
          modelID: "anthropic.claude-sonnet-4-5",
          expected: "au.anthropic.claude-sonnet-4-5",
        },
        {
          region: "ap-southeast-4",
          modelID: "anthropic.claude-haiku-v1:0",
          expected: "au.anthropic.claude-haiku-v1:0",
        },
        { region: "ap-southeast-2", modelID: "anthropic.claude-opus-4", expected: "apac.anthropic.claude-opus-4" },
        {
          region: "ap-northeast-1",
          modelID: "anthropic.claude-sonnet-4-5",
          expected: "jp.anthropic.claude-sonnet-4-5",
        },
        { region: "ap-northeast-1", modelID: "amazon.nova-pro-v1:0", expected: "jp.amazon.nova-pro-v1:0" },
        { region: "ap-south-1", modelID: "anthropic.claude-sonnet-4-5", expected: "apac.anthropic.claude-sonnet-4-5" },
        { region: "ap-south-1", modelID: "amazon.nova-lite-v1:0", expected: "apac.amazon.nova-lite-v1:0" },
        { region: "ca-central-1", modelID: "anthropic.claude-sonnet-4-5", expected: "anthropic.claude-sonnet-4-5" },
        {
          region: "us-east-1",
          modelID: "global.anthropic.claude-sonnet-4-5",
          expected: "global.anthropic.claude-sonnet-4-5",
        },
        { region: "us-east-1", modelID: "us.anthropic.claude-sonnet-4-5", expected: "us.anthropic.claude-sonnet-4-5" },
        { region: "eu-west-1", modelID: "eu.anthropic.claude-sonnet-4-5", expected: "eu.anthropic.claude-sonnet-4-5" },
        {
          region: "ap-northeast-1",
          modelID: "jp.anthropic.claude-sonnet-4-5",
          expected: "jp.anthropic.claude-sonnet-4-5",
        },
        {
          region: "ap-south-1",
          modelID: "apac.anthropic.claude-sonnet-4-5",
          expected: "apac.anthropic.claude-sonnet-4-5",
        },
        {
          region: "ap-southeast-2",
          modelID: "au.anthropic.claude-sonnet-4-5",
          expected: "au.anthropic.claude-sonnet-4-5",
        },
      ]
      yield* addPlugin()
      for (const item of cases) {
        yield* aisdk.runLanguage({
          model: Model.Info.make({
            ...Model.Info.default(Provider.ID.amazonBedrock, Model.ID.make(item.modelID)),
            modelID: Model.ID.make(item.modelID),
            package: Provider.aisdk("test-provider"),
          }),
          sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
          options: { region: item.region },
        })
      }
      expect(calls).toEqual(cases.map((item) => `languageModel:${item.expected}`))
    }),
  )

  it.effect("ignores non-Bedrock providers for language selection", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.openai, Model.ID.make("anthropic.claude-sonnet-4-5")),
          modelID: Model.ID.make("anthropic.claude-sonnet-4-5"),
          package: Provider.aisdk("test-provider"),
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: { region: "eu-west-1" },
      })
      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )

  it.effect("makes the provider available from AWS_PROFILE without treating it as a key", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const integrations = yield* Integration.Service
      const location = yield* Location.Service
      const profile = "opencode-availability-profile"
      const credentialsFile = `${location.directory}/aws-profile-credentials`
      yield* Effect.promise(() =>
        Bun.write(
          credentialsFile,
          `[${profile}]\naws_access_key_id = AKIAPROFILE\naws_secret_access_key = profile-secret\n`,
        ),
      )

      yield* withEnv(
        {
          AWS_ACCESS_KEY_ID: undefined,
          AWS_BEARER_TOKEN_BEDROCK: undefined,
          AWS_EC2_METADATA_DISABLED: "true",
          AWS_PROFILE: profile,
          AWS_REGION: undefined,
          AWS_SECRET_ACCESS_KEY: undefined,
          AWS_SHARED_CREDENTIALS_FILE: credentialsFile,
        },
        () =>
          Effect.gen(function* () {
            yield* registerBedrock(catalog)
            yield* addPlugin()

            expect((yield* catalog.provider.available()).map((provider) => provider.id)).toContain(
              Provider.ID.amazonBedrock,
            )
            expect(yield* integrations.connection.active(bedrockIntegrationID)).toBeUndefined()
          }),
      )
    }),
  )

  it.effect("never projects a region or SigV4 keys as bearer credentials", () =>
    withEnv(
      {
        AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
        AWS_BEARER_TOKEN_BEDROCK: undefined,
        AWS_PROFILE: undefined,
        AWS_REGION: "us-east-1",
        AWS_SECRET_ACCESS_KEY: "secret",
      },
      () =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          const integrations = yield* Integration.Service
          yield* registerBedrock(catalog)
          yield* addPlugin()

          const connections = required(yield* integrations.get(bedrockIntegrationID)).connections
          expect(connections).toEqual([])
          expect(yield* integrations.connection.active(bedrockIntegrationID)).toBeUndefined()
          expect((yield* catalog.provider.available()).map((provider) => provider.id)).toContain(
            Provider.ID.amazonBedrock,
          )
        }),
    ),
  )

  it.effect("prefers the Bedrock API key over ambient AWS credentials", () =>
    withEnv(
      {
        AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
        AWS_BEARER_TOKEN_BEDROCK: "token",
        AWS_PROFILE: "opencode",
        AWS_REGION: "us-east-1",
        AWS_SECRET_ACCESS_KEY: undefined,
      },
      () =>
        Effect.gen(function* () {
          const catalog = yield* Catalog.Service
          const integrations = yield* Integration.Service
          yield* registerBedrock(catalog)
          yield* addPlugin()

          const connection = required(yield* integrations.connection.active(bedrockIntegrationID))
          expect(connection).toEqual({ type: "env", name: "AWS_BEARER_TOKEN_BEDROCK" })
          expect(yield* integrations.connection.resolve(connection)).toEqual(
            Credential.Key.make({ type: "key", key: "token" }),
          )
        }),
    ),
  )
})
