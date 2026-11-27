import { Effect, Schema } from "effect"
import { Api } from "../../api.js"
import type { Capabilities } from "../../capabilities.js"
import type { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import { ProviderShared } from "../../protocols/shared.js"
import { gatewayProtocol } from "../../protocols/utils/gateway-protocol.js"
import type { ProviderPackage } from "../../provider-package.js"
import { Provider } from "../../provider.js"
import type { Framing } from "../../route/framing.js"
import type { Protocol } from "../../route/protocol.js"
import { type LLMRequest, ProviderMetadata, ReasoningEffort, type RequestOptions } from "../../schema/index.js"
import type { OpenResponsesProviderOptionsInput } from "../open-responses-options.js"

export interface GatewayOptions {
  /** Service-owned options added by the Gateway without requiring an SDK update. */
  readonly [key: string]: unknown
  /** Enables Gateway automatic prompt-cache breakpoint injection (`"auto"`). */
  readonly caching?: "auto" | (string & {})
  /** Provider slugs that are the only ones allowed to serve the request (e.g. `["anthropic", "vertex"]`). */
  readonly only?: ReadonlyArray<string>
  /** Provider slugs specifying the order in which providers are tried (e.g. `["bedrock", "anthropic"]`). */
  readonly order?: ReadonlyArray<string>
  /** Sort candidate providers by cost (`"cost"`), throughput (`"tps"`), or time-to-first-token (`"ttft"`). */
  readonly sort?: "cost" | "tps" | "ttft" | (string & {})
  /** Fallback models to try in order. */
  readonly models?: ReadonlyArray<string | Readonly<Record<string, unknown>>>
  /** Restrict routing to providers with zero data retention agreements. */
  readonly zeroDataRetention?: boolean
  /** Restrict routing to providers that do not train on prompt data. */
  readonly disallowPromptTraining?: boolean
  /**
   * Restrict routing to provider models that satisfy every entry: capability
   * tags (`"implicit-caching"`, `"reasoning"`, `"structured-output"`,
   * `"tool-use"`, `"vision"`) or weight-format filters (`"quantization:fp8"`,
   * `"!quantization:fp8"`).
   */
  readonly has?: ReadonlyArray<
    | "implicit-caching"
    | "reasoning"
    | "structured-output"
    | "tool-use"
    | "vision"
    | `quantization:${string}`
    | `!quantization:${string}`
    | (string & {})
  >
  /** Entity identifier against which Gateway quota is tracked. */
  readonly quotaEntityId?: string
  /** Unified service tier intent (`"flex"` or `"priority"`). */
  readonly serviceTier?: "flex" | "priority" | (string & {})
  /** End-user identifier for spend tracking and attribution. */
  readonly user?: string
  /** User-specified tags for reporting and filtering usage. */
  readonly tags?: ReadonlyArray<string>
  /** Request-scoped BYOK credentials keyed by provider slug, used instead of cached workspace credentials. */
  readonly byok?: Readonly<Record<string, ReadonlyArray<Readonly<Record<string, unknown>>>>>
  /** Preferred inference region for upstream provider routing. */
  readonly inferenceRegion?: string
  /** Per-provider timeouts in milliseconds (e.g. `{ byok: { anthropic: 3000 } }`). */
  readonly providerTimeouts?: {
    readonly [key: string]: unknown
    readonly byok?: Readonly<Record<string, number>>
  }
}

export type ProviderOptionsInput = OpenResponsesProviderOptionsInput &
  Omit<AnthropicMessages.OptionsInput, "thinking"> & {
    /** Reasoning configuration for Messages (`thinking`) or Chat (`reasoning.enabled` + `reasoning.max_tokens`). */
    readonly thinking?:
      | AnthropicMessages.OptionsInput["thinking"]
      | {
          readonly type: "enabled" | "adaptive" | "disabled" | (string & {})
          readonly budgetTokens?: number
          readonly budget_tokens?: number
        }
    /** Gateway routing, fallback, BYOK, compliance, and attribution options sent under `body.providerOptions.gateway`. */
    readonly gateway?: GatewayOptions
    /** Provider-specific options forwarded under their upstream namespace in `body.providerOptions` (e.g. `{ anthropic: { ... } }`). */
    readonly upstream?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    /** Responses API automatic-cache lifetime (`"5m"` or `"1h"`), sent as top-level `cache_ttl`. */
    readonly cacheTTL?: "5m" | "1h" | (string & {})
    /** Responses API count of stable input items to anchor for caching, sent as top-level `cache_anchor_items`. */
    readonly cacheAnchorItems?: number
  }

export type Settings = ProviderPackage.Settings & ProviderOptionsInput & { readonly apiKey?: string | false }

/** What every Gateway API shares. Each per-API entrypoint builds a provider from it with only its own API. */
export const shared = {
  id: "vercel-ai-gateway",
  baseURL: "https://ai-gateway.vercel.sh/v1",
  auth: Provider.apiKey(["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]),
} satisfies Omit<Provider.Input<[]>, "apis">

const GatewayOptionsSchema = Schema.Struct({
  gateway: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  upstream: Schema.optional(ProviderMetadata),
  reasoningEffort: Schema.optional(ReasoningEffort),
  thinking: Schema.optional(
    Schema.Struct({
      type: Schema.String,
      budgetTokens: Schema.optional(Schema.Number),
      budget_tokens: Schema.optional(Schema.Number),
    }),
  ),
  cacheTTL: Schema.optional(Schema.String),
  cacheAnchorItems: Schema.optional(Schema.Number),
})
const decodeOptions = ProviderShared.validateWith(Schema.decodeUnknownEffect(GatewayOptionsSchema))

const prepare = (api: "messages" | "responses" | "chat") =>
  Effect.fnUntraced(function* (request: LLMRequest) {
    const options = yield* decodeOptions(request.providerOptions ?? {})
    const providerOptions = (() => {
      if (!options.upstream && !options.gateway) return undefined
      if (!options.gateway) return options.upstream
      return { ...options.upstream, gateway: options.gateway }
    })()
    switch (api) {
      case "messages": {
        const effort = options.reasoningEffort
        if (effort === undefined) return { request, body: { providerOptions } }
        const enabled = effort !== "none"
        const thinking = request.providerOptions?.thinking ?? { type: enabled ? "adaptive" : "disabled" }
        const next = {
          ...request,
          providerOptions: {
            ...request.providerOptions,
            effort: enabled ? effort : undefined,
            thinking,
          },
        }
        return { request: next, body: { providerOptions } }
      }
      case "responses":
        return {
          request,
          body: {
            providerOptions,
            cache_ttl: options.cacheTTL,
            cache_anchor_items: options.cacheAnchorItems,
          },
        }
      case "chat": {
        if (!options.thinking) return { request, body: { providerOptions } }
        const reasoning = {
          enabled: options.thinking.type !== "disabled",
          max_tokens: options.thinking.budgetTokens ?? options.thinking.budget_tokens,
        }
        return { request, body: { providerOptions, reasoning } }
      }
    }
  })

/** One upstream API as the Gateway serves it: Gateway options in the body and Gateway metadata on the finish. */
export const api = <const Name extends string, Caps extends Capabilities.Any, Body, Event, State>(input: {
  readonly name: Name
  readonly id: string
  readonly protocol: Protocol<Body, string, Event, State>
  readonly kind: "messages" | "responses" | "chat"
  readonly path: string
  readonly framing: Framing.Definition<string>
  readonly options?: RequestOptions
  readonly capabilities?: Caps
}) =>
  Api.make({
    name: input.name,
    id: input.id,
    protocol: gatewayProtocol(input.protocol, { id: input.id, prepare: prepare(input.kind) }),
    path: input.path,
    framing: input.framing,
    headers: ({ request }): Record<string, string> =>
      request.promptCacheKey ? { "x-session-affinity": request.promptCacheKey } : {},
    options: input.options,
    capabilities: input.capabilities,
  })
