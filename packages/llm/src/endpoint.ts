import { Effect } from "effect"
import { ProviderShared } from "./provider/shared"
import type { LLMError, LLMRequest } from "./schema"

/**
 * URL construction for one adapter.
 *
 * `Endpoint` is the deployment-side answer to "where does this request go?"
 * It receives the `LLMRequest` (so it can read `model.id`, `model.baseURL`,
 * and `model.native.queryParams`) and the validated `Target` (so adapters
 * whose path depends on a target field — e.g. Bedrock's `modelId` segment —
 * can read it safely after target patches).
 *
 * The result is a `URL` object so query-param composition stays correct
 * regardless of caller-provided baseURL trailing slashes.
 */
export type Endpoint<Target> = (input: EndpointInput<Target>) => Effect.Effect<URL, LLMError>

export interface EndpointInput<Target> {
  readonly request: LLMRequest
  readonly target: Target
}

/**
 * Build a URL from the model's `baseURL` (or a default) plus a path. Appends
 * `model.queryParams` so adapters that need request-level query params
 * (Azure `api-version`, etc.) get them for free.
 *
 * Both `default` and `path` may be strings or functions of the
 * `EndpointInput`, for adapters whose URL embeds the model id, region, or
 * another target field.
 */
export const baseURL = <Target>(input: {
  readonly default?: string | ((input: EndpointInput<Target>) => string)
  readonly path: string | ((input: EndpointInput<Target>) => string)
  /** Error message used when neither `model.baseURL` nor `default` is set. */
  readonly required?: string
}): Endpoint<Target> => (ctx) =>
  Effect.gen(function* () {
    const fallback = typeof input.default === "function" ? input.default(ctx) : input.default
    const base = ctx.request.model.baseURL ?? fallback
    if (!base) return yield* ProviderShared.invalidRequest(input.required ?? "Missing baseURL")
    const path = typeof input.path === "string" ? input.path : input.path(ctx)
    const url = new URL(`${ProviderShared.trimBaseUrl(base)}${path}`)
    const params = ctx.request.model.queryParams
    if (params) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return url
  })

export * as Endpoint from "./endpoint"
