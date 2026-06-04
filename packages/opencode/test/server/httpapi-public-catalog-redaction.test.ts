import { describe, expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Schema } from "effect"
import { OpenApi } from "effect/unstable/httpapi"
import { PublicApi } from "../../src/server/routes/instance/httpapi/public"

type OpenApiSchema = {
  readonly $ref?: string
  readonly items?: OpenApiSchema
  readonly properties?: Record<string, OpenApiSchema>
}

type OpenApiSpec = {
  readonly components?: { readonly schemas?: Record<string, OpenApiSchema> }
  readonly paths: Record<
    string,
    {
      readonly get?: {
        readonly responses?: Record<string, { readonly content?: Record<string, { schema?: OpenApiSchema }> }>
      }
    }
  >
}

function responseSchema(spec: OpenApiSpec, path: string) {
  return spec.paths[path]?.get?.responses?.["200"]?.content?.["application/json"]?.schema
}

function componentName(ref: string | undefined) {
  return ref?.replace("#/components/schemas/", "")
}

describe("PublicApi v2 catalog redaction", () => {
  test("routes use redacted provider and model DTO schemas", () => {
    const spec = OpenApi.fromApi(PublicApi) as OpenApiSpec
    const provider = responseSchema(spec, "/api/provider/{providerID}")
    const providers = responseSchema(spec, "/api/provider")
    const models = responseSchema(spec, "/api/model")

    expect(componentName(provider?.$ref)).toBe("ProviderV2PublicInfo")
    expect(componentName(providers?.items?.$ref)).toBe("ProviderV2PublicInfo")
    expect(componentName(models?.items?.$ref)).toBe("ModelV2PublicInfo")

    const providerProperties = spec.components?.schemas?.ProviderV2PublicInfo?.properties
    const modelProperties = spec.components?.schemas?.ModelV2PublicInfo?.properties
    expect(providerProperties).not.toHaveProperty("request")
    expect(modelProperties).not.toHaveProperty("request")
    expect(JSON.stringify(providerProperties)).not.toMatch(/settings|headers|body|data/)
    expect(JSON.stringify(modelProperties)).not.toMatch(/settings|headers|body/)
  })

  test("DTOs sanitize provider and model API URLs", () => {
    const providerID = ProviderV2.ID.make("test")
    const providers = [
      new ProviderV2.Info({
        ...ProviderV2.Info.empty(providerID),
        api: {
          type: "native",
          url: "https://provider-user:provider-password@example.com:8443/provider/v1?api_key=provider-secret#fragment",
          settings: {},
        },
      }),
      new ProviderV2.Info({
        ...ProviderV2.Info.empty(providerID),
        api: {
          type: "aisdk",
          package: "@ai-sdk/openai",
          url: "https://provider-aisdk-user:provider-aisdk-password@example.com:8444/provider/aisdk?api_key=provider-aisdk-secret#fragment",
        },
      }),
    ].map((provider) => Schema.encodeSync(ProviderV2.PublicInfo)(ProviderV2.toPublic(provider)))
    const models = [
      new ModelV2.Info({
        ...ModelV2.Info.empty(providerID, ModelV2.ID.make("native")),
        api: {
          id: ModelV2.ID.make("native"),
          type: "native",
          url: "https://native-user:native-password@example.com:9443/native/v1?api_key=native-secret#fragment",
          settings: {},
        },
      }),
      new ModelV2.Info({
        ...ModelV2.Info.empty(providerID, ModelV2.ID.make("aisdk")),
        api: {
          id: ModelV2.ID.make("aisdk"),
          type: "aisdk",
          package: "@ai-sdk/openai",
          url: "https://aisdk-user:aisdk-password@example.com:10443/aisdk/v1?api_key=aisdk-secret#fragment",
        },
      }),
    ].map((model) => Schema.encodeSync(ModelV2.PublicInfo)(ModelV2.toPublic(model)))

    expect(providers.map((provider) => provider.api)).toEqual([
      { type: "native", url: "https://example.com:8443" },
      { type: "aisdk", package: "@ai-sdk/openai", url: "https://example.com:8444" },
    ])
    expect(models.map((model) => model.api)).toEqual([
      { id: "native", type: "native", url: "https://example.com:9443" },
      { id: "aisdk", type: "aisdk", package: "@ai-sdk/openai", url: "https://example.com:10443" },
    ])
    expect(JSON.stringify({ providers, models })).not.toMatch(/user|password|api_key|secret|fragment/)
  })

  test("DTOs omit malformed API URLs", () => {
    const providerID = ProviderV2.ID.make("test")
    const provider = Schema.encodeSync(ProviderV2.PublicInfo)(
      ProviderV2.toPublic(
        new ProviderV2.Info({
          ...ProviderV2.Info.empty(providerID),
          api: { type: "native", url: "not a url?api_key=provider-secret", settings: {} },
        }),
      ),
    )
    const modelID = ModelV2.ID.make("aisdk")
    const model = Schema.encodeSync(ModelV2.PublicInfo)(
      ModelV2.toPublic(
        new ModelV2.Info({
          ...ModelV2.Info.empty(providerID, modelID),
          api: { id: modelID, type: "aisdk", package: "@ai-sdk/openai", url: "model-secret" },
        }),
      ),
    )

    expect(provider.api).toEqual({ type: "native" })
    expect(model.api).toEqual({ id: "aisdk", type: "aisdk", package: "@ai-sdk/openai" })
    expect(JSON.stringify({ provider, model })).not.toMatch(/secret|api_key/)
  })
})
