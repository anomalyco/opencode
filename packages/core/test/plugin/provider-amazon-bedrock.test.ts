import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Integration } from "@opencode-ai/core/integration"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { AmazonBedrockPlugin } from "@opencode-ai/core/plugin/provider/amazon-bedrock"
import { Provider } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* AmazonBedrockPlugin.effect(host)
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

const noAmbientAWS = {
  AWS_PROFILE: undefined,
  AWS_ACCESS_KEY_ID: undefined,
  AWS_WEB_IDENTITY_TOKEN_FILE: undefined,
  AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: undefined,
  AWS_CONTAINER_CREDENTIALS_FULL_URI: undefined,
  AWS_REGION: undefined,
  AWS_DEFAULT_REGION: undefined,
}

const seedBedrock = Effect.fn(function* (settings?: Record<string, unknown>) {
  const catalog = yield* Catalog.Service
  yield* catalog.transform((catalog) => {
    catalog.provider.update(Provider.ID.amazonBedrock, (item) => {
      item.package = Provider.aisdk("@ai-sdk/amazon-bedrock")
      if (settings) item.settings = settings
    })
  })
  return catalog
})

describe("AmazonBedrockPlugin", () => {
  it.effect("moves endpoint setting to baseURL", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock({ endpoint: "https://bedrock.example" })
        yield* addPlugin()
        const result = required(yield* catalog.provider.get(Provider.ID.amazonBedrock))
        expect(result.package).toBe(Provider.aisdk("@ai-sdk/amazon-bedrock"))
        expect(result.settings).toEqual({ baseURL: "https://bedrock.example" })
      }),
    ),
  )

  it.effect("keeps an explicit baseURL over endpoint", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock({ baseURL: "https://base.example", endpoint: "https://endpoint.example" })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).settings).toEqual({
          baseURL: "https://base.example",
        })
      }),
    ),
  )

  it.effect("only treats the bearer token env var as a key credential", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make(Provider.ID.amazonBedrock)
      yield* integrations.transform((editor) => {
        editor.method.update({ integrationID, method: { type: "key" } })
        editor.method.update({
          integrationID,
          method: {
            type: "env",
            names: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AWS_BEARER_TOKEN_BEDROCK"],
          },
        })
      })
      yield* addPlugin()
      expect((yield* integrations.get(integrationID))?.methods).toEqual([
        { type: "key" },
        { type: "env", names: ["AWS_BEARER_TOKEN_BEDROCK"] },
      ])
    }),
  )

  it.effect("leaves activation on auto without ambient AWS configuration", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock()
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).activation).toBe("auto")
      }),
    ),
  )

  for (const name of Object.keys(noAmbientAWS).filter((name) => !name.includes("REGION"))) {
    it.effect(`enables the provider when ${name} is set`, () =>
      withEnv({ ...noAmbientAWS, [name]: "value" }, () =>
        Effect.gen(function* () {
          const catalog = yield* seedBedrock()
          yield* addPlugin()
          expect(required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).activation).toBe("enabled")
        }),
      ),
    )
  }

  it.effect("enables the provider when a profile is configured", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock({ profile: "work" })
        yield* addPlugin()
        const result = required(yield* catalog.provider.get(Provider.ID.amazonBedrock))
        expect(result.activation).toBe("enabled")
        expect(result.settings).toEqual({ profile: "work" })
      }),
    ),
  )

  it.effect("does not override a disabled provider", () =>
    withEnv({ ...noAmbientAWS, AWS_PROFILE: "work" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.amazonBedrock, (item) => {
            item.package = Provider.aisdk("@ai-sdk/amazon-bedrock")
            item.activation = "disabled"
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).activation).toBe("disabled")
      }),
    ),
  )

  it.effect("fills region from AWS_REGION then AWS_DEFAULT_REGION without overriding config", () =>
    withEnv({ ...noAmbientAWS, AWS_REGION: "eu-west-1", AWS_DEFAULT_REGION: "us-west-2" }, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock()
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).settings).toEqual({
          region: "eu-west-1",
        })

        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.amazonBedrock, (item) => {
            item.settings = { region: "ap-southeast-2" }
          })
        })
        expect(required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).settings).toEqual({
          region: "ap-southeast-2",
        })
      }),
    ),
  )

  it.effect("falls back to AWS_DEFAULT_REGION", () =>
    withEnv({ ...noAmbientAWS, AWS_DEFAULT_REGION: "us-west-2" }, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock()
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).settings).toEqual({
          region: "us-west-2",
        })
      }),
    ),
  )

  it.effect("applies to Mantle and native Bedrock packages", () =>
    withEnv({ ...noAmbientAWS, AWS_PROFILE: "work" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.make("mantle"), (item) => {
            item.package = Provider.aisdk("@ai-sdk/amazon-bedrock/mantle")
          })
          catalog.provider.update(Provider.ID.make("native"), (item) => {
            item.package = "@opencode-ai/ai/providers/amazon-bedrock"
          })
          catalog.provider.update(Provider.ID.make("other"), (item) => {
            item.package = Provider.aisdk("@ai-sdk/anthropic")
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.make("mantle"))).activation).toBe("enabled")
        expect(required(yield* catalog.provider.get(Provider.ID.make("native"))).activation).toBe("enabled")
        expect(required(yield* catalog.provider.get(Provider.ID.make("other"))).activation).toBe("auto")
      }),
    ),
  )
})
