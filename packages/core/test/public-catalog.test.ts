import { describe, expect, test } from "bun:test"
import { Catalog } from "@opencode-ai/core/catalog"
import { EventV2 } from "@opencode-ai/core/event"
import { Location } from "@opencode-ai/core/location"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Effect, Layer, Schema } from "effect"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const locationLayer = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("test") })),
)
const it = testEffect(
  Catalog.locationLayer.pipe(Layer.provideMerge(EventV2.defaultLayer), Layer.provideMerge(locationLayer)),
)

const encodeProvider = Schema.encodeSync(ProviderV2.PublicInfo)
const encodeModel = Schema.encodeSync(ModelV2.PublicInfo)

describe("public catalog DTOs", () => {
  test("provider DTO excludes credentials and internal settings", () => {
    const providerID = ProviderV2.ID.make("test")
    const encoded = encodeProvider(
      ProviderV2.toPublic(
        new ProviderV2.Info({
          ...ProviderV2.Info.empty(providerID),
          enabled: { via: "account", service: "test-account" },
          env: ["TEST_API_KEY"],
          api: { type: "native", url: "https://example.com", settings: { apiKey: "settings-secret" } },
          request: {
            headers: { Authorization: "Bearer header-secret", "x-api-key": "header-secret" },
            body: { apiKey: "body-secret", account: "account-body-secret" },
          },
        }),
      ),
    )

    expect(encoded).toEqual({
      id: "test",
      name: "test",
      enabled: { via: "account", service: "test-account" },
      env: ["TEST_API_KEY"],
      api: { type: "native", url: "https://example.com" },
    })
    expect(JSON.stringify(encoded)).not.toMatch(/Authorization|x-api-key|apiKey|account-body-secret|settings-secret/)
  })

  test("provider DTO excludes custom enabled metadata", () => {
    const providerID = ProviderV2.ID.make("custom")
    const encoded = encodeProvider(
      ProviderV2.toPublic(
        new ProviderV2.Info({
          ...ProviderV2.Info.empty(providerID),
          enabled: { via: "custom", data: { apiKey: "custom-secret" } },
        }),
      ),
    )

    expect(encoded.enabled).toEqual({ via: "custom" })
    expect(JSON.stringify(encoded)).not.toContain("custom-secret")
  })

  it.effect("model DTO excludes resolved provider requests and variant requests", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const providerID = ProviderV2.ID.make("test")
      const modelID = ModelV2.ID.make("model")
      const transform = yield* catalog.transform()

      yield* transform((catalog) => {
        catalog.provider.update(providerID, (provider) => {
          provider.enabled = { via: "account", service: "test-account" }
          provider.api = { type: "native", url: "https://example.com", settings: { apiKey: "settings-secret" } }
          provider.request.headers.Authorization = "Bearer provider-secret"
          provider.request.body.apiKey = "provider-body-secret"
          provider.request.body.account = "account-body-secret"
        })
        catalog.model.update(providerID, modelID, (model) => {
          model.request.headers["x-api-key"] = "model-header-secret"
          model.request.body.apiKey = "model-body-secret"
          model.variants.push({
            id: ModelV2.VariantID.make("fast"),
            headers: { Authorization: "Bearer variant-secret" },
            body: { apiKey: "variant-body-secret" },
          })
        })
      })

      const model = yield* catalog.model.get(providerID, modelID)
      expect(model.request.headers.Authorization).toBe("Bearer provider-secret")
      expect(model.request.headers["x-api-key"]).toBe("model-header-secret")
      expect(model.request.body.apiKey).toBe("model-body-secret")
      expect(model.request.body.account).toBe("account-body-secret")
      expect(model.api).toHaveProperty("settings.apiKey", "settings-secret")

      const encoded = encodeModel(ModelV2.toPublic(model))
      expect(encoded.api).toEqual({ id: "model", type: "native", url: "https://example.com" })
      expect(encoded.variants).toEqual([{ id: "fast" }])
      expect(encoded).not.toHaveProperty("request")
      expect(JSON.stringify(encoded)).not.toMatch(
        /Authorization|x-api-key|apiKey|account-body-secret|provider-secret|model-header-secret|variant-secret|settings-secret/,
      )
    }),
  )
})
