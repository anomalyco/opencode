import { OpenApi } from "effect/unstable/httpapi"
import { api } from "./definition/api.js"
import type { OpenApiSpec } from "./types.js"

export const openapi = (): OpenApiSpec => OpenApi.fromApi(api)
