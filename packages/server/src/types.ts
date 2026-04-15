import type { HttpApi, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export type ServerApi = HttpApi.HttpApi<string, HttpApiGroup.Any>

export type OpenApiSpec = OpenApi.OpenAPISpec
