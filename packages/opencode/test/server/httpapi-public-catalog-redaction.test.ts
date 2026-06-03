import { describe, expect, test } from "bun:test"
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
    { readonly get?: { readonly responses?: Record<string, { readonly content?: Record<string, { schema?: OpenApiSchema }> }> } }
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
})
