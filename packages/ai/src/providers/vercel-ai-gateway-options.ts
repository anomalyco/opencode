import { Schema } from "effect"
import type { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { ReasoningEffort } from "../schema/index.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

/** Gateway routing controls are independent of the selected wire API. */
const Credential = Schema.StructWithRest(
  Schema.Struct({
    apiKey: Schema.optional(Schema.String),
    resourceName: Schema.optional(Schema.String),
    accessKeyId: Schema.optional(Schema.String),
    secretAccessKey: Schema.optional(Schema.String),
    region: Schema.optional(Schema.String),
    project: Schema.optional(Schema.String),
    location: Schema.optional(Schema.String),
    googleCredentials: Schema.optional(Schema.Struct({ privateKey: Schema.String, clientEmail: Schema.String })),
    modelMappings: Schema.optional(
      Schema.Array(Schema.Struct({ gatewayModelSlug: Schema.String, customModelId: Schema.String })),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

export const GatewayOptions = Schema.StructWithRest(
  Schema.Struct({
    caching: Schema.optional(Schema.Literal("auto")),
    only: Schema.optional(Schema.Array(Schema.String)),
    order: Schema.optional(Schema.Array(Schema.String)),
    sort: Schema.optional(Schema.String),
    models: Schema.optional(Schema.Array(Schema.String)),
    zeroDataRetention: Schema.optional(Schema.Boolean),
    user: Schema.optional(Schema.String),
    tags: Schema.optional(Schema.Array(Schema.String)),
    byok: Schema.optional(Schema.Record(Schema.String, Schema.Array(Credential))),
    inferenceRegion: Schema.optional(Schema.String),
    providerTimeouts: Schema.optional(
      Schema.Struct({
        byok: Schema.optional(
          Schema.Record(Schema.String, Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 789000 }))),
        ),
      }),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
export type GatewayOptions = typeof GatewayOptions.Type

export const Options = Schema.Struct({
  gateway: Schema.optional(GatewayOptions),
  upstream: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
  reasoningEffort: Schema.optional(ReasoningEffort),
  effort: Schema.optional(ReasoningEffort),
  cacheTTL: Schema.optional(Schema.Literals(["5m", "1h"])),
  cacheAnchorItems: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
})

export type ProviderOptionsInput = OpenResponsesProviderOptionsInput &
  Pick<AnthropicMessages.OptionsInput, "thinking" | "outputConfig" | "effort" | "metadata" | "cacheControl"> & {
    readonly gateway?: GatewayOptions
    /** AI SDK upstream settings, forwarded under their original provider namespace. */
    readonly upstream?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    /** Responses automatic-cache lifetime; not the lifetime of manually marked blocks. */
    readonly cacheTTL?: "5m" | "1h"
    /** Responses input-item count, not a canonical message count. */
    readonly cacheAnchorItems?: number
  }

export * as VercelAIGatewayOptions from "./vercel-ai-gateway-options.js"
