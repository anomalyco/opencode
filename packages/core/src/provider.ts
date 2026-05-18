export * as ProviderV2 from "./provider"

import { withStatics } from "./schema"
import { Schema } from "effect"

export const ID = Schema.String.pipe(
  Schema.brand("ProviderV2.ID"),
  withStatics((schema) => ({
    // Well-known providers
    opencode: schema.make("opencode"),
    anthropic: schema.make("anthropic"),
    openai: schema.make("openai"),
    google: schema.make("google"),
    googleVertex: schema.make("google-vertex"),
    githubCopilot: schema.make("github-copilot"),
    amazonBedrock: schema.make("amazon-bedrock"),
    azure: schema.make("azure"),
    openrouter: schema.make("openrouter"),
    mistral: schema.make("mistral"),
    gitlab: schema.make("gitlab"),
  })),
)
export type ID = typeof ID.Type

const OpenAIResponses = Schema.Struct({
  type: Schema.Literal("openai/responses"),
  url: Schema.String,
  websocket: Schema.optional(Schema.Boolean),
})

const OpenAICompletions = Schema.Struct({
  type: Schema.Literal("openai/completions"),
  url: Schema.String,
  reasoning: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("reasoning_content"),
    }),
    Schema.Struct({
      type: Schema.Literal("reasoning_details"),
    }),
  ]).pipe(Schema.optional),
})
export type OpenAICompletions = typeof OpenAICompletions.Type

const AISDK = Schema.Struct({
  type: Schema.Literal("aisdk"),
  package: Schema.String,
  url: Schema.String.pipe(Schema.optional),
})

const AnthropicMessages = Schema.Struct({
  type: Schema.Literal("anthropic/messages"),
  url: Schema.String,
})

const UnknownEndpoint = Schema.Struct({
  type: Schema.Literal("unknown"),
})

export const Endpoint = Schema.Union([
  UnknownEndpoint,
  OpenAIResponses,
  OpenAICompletions,
  AnthropicMessages,
  AISDK,
]).pipe(Schema.toTaggedUnion("type"))
export type Endpoint = typeof Endpoint.Type

export const Options = Schema.Struct({
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Record(Schema.String, Schema.Any),
  aisdk: Schema.Struct({
    provider: Schema.Record(Schema.String, Schema.Any),
    request: Schema.Record(Schema.String, Schema.Any),
  }),
})
export type Options = typeof Options.Type

export class Info extends Schema.Class<Info>("ProviderV2.Info")({
  id: ID,
  name: Schema.String,
  enabled: Schema.Union([
    Schema.Literal(false),
    Schema.Struct({
      via: Schema.Literal("env"),
      name: Schema.String,
    }),
    Schema.Struct({
      via: Schema.Literal("auth"),
      service: Schema.String,
    }),
    Schema.Struct({
      via: Schema.Literal("custom"),
      data: Schema.Record(Schema.String, Schema.Any),
    }),
  ]),
  env: Schema.String.pipe(Schema.Array),
  endpoint: Endpoint,
  options: Options,
}) {
  static empty(providerID: ID) {
    return new Info({
      id: providerID,
      name: providerID,
      enabled: false,
      env: [],
      endpoint: {
        type: "unknown",
      },
      options: {
        headers: {},
        body: {},
        aisdk: {
          provider: {},
          request: {},
        },
      },
    })
  }
}
