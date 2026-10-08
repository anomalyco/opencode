import type { GenerateApi } from "@opencode/client/effect/api"
import type { Model } from "@opencode/schema/model"
import type { ModelHooks } from "./registration.js"

/** Stateless completion identity; no Session exists for this request. */
export interface GenerateHttpRequest {
  readonly requestID: string
  readonly model: Model.Ref
  request: Request
}

export interface GenerateHttpResponse {
  readonly requestID: string
  readonly model: Model.Ref
  readonly request: Request
  response: Response
}

export interface GenerateHooks {
  readonly "http.request": GenerateHttpRequest
  readonly "http.response": GenerateHttpResponse
}

export type GenerateDomain = GenerateApi<unknown> & {
  readonly hook: ModelHooks<GenerateHooks>
}
