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

export const ApiFormat = Schema.Union([
  Schema.Literal("openai/responses"),
  Schema.Literal("openai/completions"),
  Schema.Literal("anthropic"),
])

const Modalities = Schema.Struct({
  text: Schema.Boolean,
  audio: Schema.Boolean,
  image: Schema.Boolean,
  video: Schema.Boolean,
  pdf: Schema.Boolean,
})

export const Capabilities = Schema.Struct({
  temperature: Schema.Boolean,
  reasoning: Schema.Boolean,
  attachment: Schema.Boolean,
  toolcall: Schema.Boolean,
  small: Schema.Boolean,
  input: Modalities,
  output: Modalities,
})

export class Info extends Schema.Class<Info>("Model.Info")({
  id: ID,
  providerID: ProviderID,
  api: Schema.Struct({
    format: ApiFormat,
    url: Schema.String,
    headers: Schema.Record(Schema.String, Schema.String),
  }),
  capabilities: Capabilities,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  variants: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Any)),
  time: Schema.Struct({
    released: DateTimeUtcFromMillis,
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
        const match = all.find((model) => model.capabilities.small && model.providerID === providerID)
        return Option.fromUndefinedOr(match)
      }),
    }

    return Service.of(result)
  }),
)

export const defaultLayer = layer

export * as Modelv2 from "./model"
