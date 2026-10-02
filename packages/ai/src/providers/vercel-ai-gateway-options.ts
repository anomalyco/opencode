import { Schema } from "effect"
import type { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { ReasoningEffort } from "../schema/index.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

export interface GatewayOptions {
  readonly [key: string]: unknown
  readonly caching?: "auto"
  readonly only?: ReadonlyArray<string>
  readonly order?: ReadonlyArray<string>
  readonly sort?: string
  readonly models?: ReadonlyArray<string>
  readonly zeroDataRetention?: boolean
  readonly user?: string
  readonly tags?: ReadonlyArray<string>
  readonly byok?: Readonly<Record<string, ReadonlyArray<Readonly<Record<string, unknown>>>>>
  readonly inferenceRegion?: string
  readonly providerTimeouts?: { readonly byok?: Readonly<Record<string, number>> }
}

export const Options = Schema.Struct({
  gateway: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  upstream: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
  reasoningEffort: Schema.optional(ReasoningEffort),
  cacheTTL: Schema.optional(Schema.String),
  cacheAnchorItems: Schema.optional(Schema.Number),
})

export type ProviderOptionsInput = OpenResponsesProviderOptionsInput &
  AnthropicMessages.OptionsInput & {
    readonly gateway?: GatewayOptions
    /** Upstream options forwarded under their Gateway provider namespace. */
    readonly upstream?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    /** Responses automatic-cache lifetime. */
    readonly cacheTTL?: "5m" | "1h" | (string & {})
    /** Number of stable Responses input items. */
    readonly cacheAnchorItems?: number
  }

export * as VercelAIGatewayOptions from "./vercel-ai-gateway-options.js"
