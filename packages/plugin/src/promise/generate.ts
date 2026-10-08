import type { GenerateApi } from "@opencode/client/promise/api"
import type { GenerateHooks } from "../effect/generate.js"
import type { ModelHooks } from "./registration.js"

export type { GenerateHooks, GenerateHttpRequest, GenerateHttpResponse } from "../effect/generate.js"

export type GenerateDomain = GenerateApi & {
  readonly hook: ModelHooks<GenerateHooks>
}
