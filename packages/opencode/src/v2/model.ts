import { withStatics } from "@/util/schema"
import { Array, Context, Effect, HashMap, Layer, Option, Order, pipe, Schema } from "effect"
import { DateTimeUtcFromMillis } from "effect/Schema"

export const ID = Schema.String.pipe(Schema.brand("Model.ID"))
export type ID = typeof ID.Type

export const ProviderID = Schema.String.pipe(
  Schema.brand("Model.ProviderID"),
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
export type ProviderID = typeof ProviderID.Type

export const VariantID = Schema.String.pipe(Schema.brand("VariantID"))
export type VariantID = typeof VariantID.Type

// Grouping of models, eg claude opus, claude sonnet
export const Family = Schema.String.pipe(Schema.brand("Family"))
export type Family = typeof Family.Type

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

const AnthropicMessages = Schema.Struct({
  type: Schema.Literal("anthropic/messages"),
  url: Schema.String,
})

export const Endpoint = Schema.Union([OpenAIResponses, OpenAICompletions, AnthropicMessages]).pipe(
  Schema.toTaggedUnion("type"),
)
export type Endpoint = typeof Endpoint.Type

export const Capabilities = Schema.Struct({
  tools: Schema.Boolean,
  // mime patterns, image, audio, video/*, text/*
  input: Schema.String.pipe(Schema.Array),
  output: Schema.String.pipe(Schema.Array),
})
export type Capabilities = typeof Capabilities.Type

export const Options = Schema.Struct({
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Record(Schema.String, Schema.Any),
})
export type Options = typeof Options.Type

export const Cost = Schema.Struct({
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Int,
  }).pipe(Schema.optional),
  input: Schema.Finite,
  output: Schema.Finite,
  cache: Schema.Struct({
    read: Schema.Finite,
    write: Schema.Finite,
  }),
})

export const Ref = Schema.Struct({
  id: ID,
  providerID: ProviderID,
  variant: VariantID,
})
export type Ref = typeof Ref.Type

export class Info extends Schema.Class<Info>("Model.Info")({
  id: ID,
  providerID: ProviderID,
  family: Family.pipe(Schema.optional),
  name: Schema.String,
  endpoint: Endpoint,
  capabilities: Capabilities,
  options: Schema.Struct({
    ...Options.fields,
    variant: Schema.String.pipe(Schema.optional),
  }),
  variants: Schema.Struct({
    id: VariantID,
    ...Options.fields,
  }).pipe(Schema.Array),
  time: Schema.Struct({
    released: DateTimeUtcFromMillis,
  }),
  cost: Cost.pipe(Schema.Array),
  status: Schema.Literals(["alpha", "beta", "deprecated", "active"]),
  limit: Schema.Struct({
    context: Schema.Int,
    input: Schema.Int.pipe(Schema.optional),
    output: Schema.Int,
  }),
}) {}

export function parse(input: string): { providerID: ProviderID; modelID: ID } {
  const [providerID, ...modelID] = input.split("/")
  return {
    providerID: ProviderID.make(providerID),
    modelID: ID.make(modelID.join("/")),
  }
}

export interface Interface {
  readonly get: (providerID: ProviderID, modelID: ID) => Effect.Effect<Option.Option<Info>>
  readonly add: (model: Info) => Effect.Effect<void>
  readonly remove: (providerID: ProviderID, modelID: ID) => Effect.Effect<void>
  readonly all: () => Effect.Effect<Info[]>
  readonly default: () => Effect.Effect<Option.Option<Info>>
  readonly small: (provider: ProviderID) => Effect.Effect<Option.Option<Info>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Model") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let models = HashMap.empty<string, Info>()

    function key(providerID: ProviderID, modelID: ID) {
      return `${providerID}/${modelID}`
    }

    const result: Interface = {
      get: Effect.fn("V2Model.get")(function* (providerID, modelID) {
        return HashMap.get(models, key(providerID, modelID))
      }),

      add: Effect.fn("V2Model.add")(function* (model) {
        models = HashMap.set(models, key(model.providerID, model.id), model)
      }),

      remove: Effect.fn("V2Model.remove")(function* (providerID, modelID) {
        models = HashMap.remove(models, key(providerID, modelID))
      }),

      all: Effect.fn("V2Model.all")(function* () {
        return pipe(
          models,
          HashMap.toValues,
          Array.sortWith((item) => item.time.released.epochMilliseconds, Order.flip(Order.Number)),
        )
      }),

      default: Effect.fn("V2Model.default")(function* () {
        const all = yield* result.all()
        return Option.fromUndefinedOr(all[0])
      }),

      small: Effect.fn("V2Model.small")(function* (providerID) {
        const all = yield* result.all()
        const match = all.find((model) => model.providerID === providerID && model.id.toLowerCase().includes("small"))
        return Option.fromUndefinedOr(match)
      }),
    }

    return Service.of(result)
  }),
)

export const defaultLayer = layer

export * as Modelv2 from "./model"
