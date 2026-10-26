import { Option, Schema } from "effect"

// models.dev v1 catalogs (`/api.json`), still accepted from OPENCODE_MODELS_PATH and custom
// OPENCODE_MODELS_URL mirrors. They are converted to the v2 shape, then decoded like any v2 catalog.
// v1 can't say everything v2 does (one API per model, broad modality kinds), so a converted catalog
// behaves as v1 did.

const Price = Schema.Finite
const Cost = Schema.Struct({
  input: Schema.optional(Price),
  output: Schema.optional(Price),
  cache_read: Schema.optional(Price),
  cache_write: Schema.optional(Price),
  tiers: Schema.optional(
    Schema.Array(
      Schema.Struct({
        tier: Schema.Struct({ size: Schema.Finite }),
        input: Schema.optional(Price),
        output: Schema.optional(Price),
        cache_read: Schema.optional(Price),
        cache_write: Schema.optional(Price),
      }),
    ),
  ),
})
type Cost = typeof Cost.Type

const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  release_date: Schema.String,
  status: Schema.optional(Schema.String),
  reasoning: Schema.optional(Schema.Boolean),
  reasoning_options: Schema.optional(
    Schema.Array(
      Schema.Struct({
        type: Schema.String,
        values: Schema.optional(Schema.Array(Schema.NullOr(Schema.String))),
        min: Schema.optional(Schema.Finite),
        max: Schema.optional(Schema.Finite),
      }),
    ),
  ),
  temperature: Schema.optional(Schema.Boolean),
  tool_call: Schema.optional(Schema.Boolean),
  interleaved: Schema.optional(Schema.Union([Schema.Boolean, Schema.String, Schema.Struct({ field: Schema.String })])),
  cost: Schema.optional(Cost),
  limit: Schema.optional(Schema.Record(Schema.String, Schema.Finite)),
  modalities: Schema.optional(
    Schema.Struct({ input: Schema.Array(Schema.String), output: Schema.Array(Schema.String) }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      modes: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            cost: Schema.optional(Cost),
            provider: Schema.optional(
              Schema.Struct({
                body: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
                headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
  provider: Schema.optional(
    Schema.Struct({
      npm: Schema.optional(Schema.String),
      api: Schema.optional(Schema.String),
      shape: Schema.optional(Schema.String),
    }),
  ),
})
type Model = typeof Model.Type

const Provider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  env: Schema.Array(Schema.String),
  npm: Schema.String,
  api: Schema.optional(Schema.String),
  models: Schema.Record(Schema.String, Schema.Unknown),
})

const decodeProvider = Schema.decodeUnknownOption(Provider)
const decodeModel = Schema.decodeUnknownOption(Model)
const HasNpm = Schema.decodeUnknownOption(Schema.Struct({ npm: Schema.String }))

/** v1 providers always name an AI SDK package (`npm`); v2 providers never do. */
export function isV1(catalog: Record<string, unknown>) {
  return Object.values(catalog).some((provider) => Option.isSome(HasNpm(provider)))
}

export function toV2(catalog: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(catalog).flatMap(([key, value]) => {
      const provider = Option.getOrUndefined(decodeProvider(value))
      if (!provider) return []
      const models = Object.entries(provider.models).flatMap(([id, value]) => {
        const model = Option.getOrUndefined(decodeModel(value))
        return model ? [[id, convertModel(model, provider)] as const] : []
      })
      return [[key, { id: provider.id, name: provider.name, env: provider.env, models: Object.fromEntries(models) }]]
    }),
  )
}

// The AI SDK packages that call the Responses API unless told otherwise.
const RESPONSES_BY_DEFAULT = new Set(["@ai-sdk/openai", "@ai-sdk/azure", "@ai-sdk/xai"])

function convertModel(model: Model, provider: typeof Provider.Type) {
  const npm = model.provider?.npm ?? provider.npm
  const shape = model.provider?.shape
  const protocol =
    shape === "responses" || (shape === undefined && RESPONSES_BY_DEFAULT.has(npm)) ? "responses" : "chat-completions"
  const field =
    typeof model.interleaved === "string"
      ? model.interleaved
      : typeof model.interleaved === "object"
        ? model.interleaved.field
        : undefined
  return {
    id: model.id,
    type: model.type ?? "chat",
    name: model.name,
    family: model.family,
    release_date: model.release_date,
    status: model.status,
    modalities: model.modalities ?? { input: ["text"], output: ["text"] },
    capabilities: {
      tools: { supported: model.tool_call ?? false },
      reasoning: reasoning(model),
      temperature: model.temperature,
    },
    limit: model.limit,
    cost: model.cost && cost(model.cost),
    api: {
      [protocol]: {
        base_url: model.provider?.api ?? provider.api ?? "",
        sdk: { aisdk: npm },
        ...(field ? { compatibility: { reasoning_field: field } } : {}),
      },
    },
    experimental: model.experimental?.modes && {
      modes: Object.fromEntries(
        Object.entries(model.experimental.modes).map(([name, mode]) => [
          name,
          { cost: mode.cost && cost(mode.cost), body: mode.provider?.body, headers: mode.provider?.headers },
        ]),
      ),
    },
  }
}

function reasoning(model: Model) {
  if (!model.reasoning) return { supported: false }
  const options = model.reasoning_options ?? []
  const effort = options.find((option) => option.type === "effort")
  const budget = options.find((option) => option.type === "budget_tokens")
  return {
    supported: true,
    ...(options.some((option) => option.type === "toggle") ? { toggle: true } : {}),
    ...(effort
      ? { effort: (effort.values ?? []).filter((value): value is string => value !== null && value !== "null") }
      : {}),
    ...(budget
      ? {
          budget: {
            ...(budget.min !== undefined ? { min: budget.min } : {}),
            ...(budget.max !== undefined ? { max: budget.max } : {}),
          },
        }
      : {}),
  }
}

// v1 tiers are context bands; v2 says the same with `context` overrides.
function cost(input: Cost) {
  const tiers = input.tiers ?? []
  return {
    text: {
      input: {
        price: input.input ?? 0,
        cache: { read: input.cache_read, write: input.cache_write },
        overrides: tiers.map((tier) => ({
          when: { context: { gt: tier.tier.size } },
          price: tier.input,
          cache: { read: tier.cache_read, write: tier.cache_write },
        })),
      },
      output: {
        price: input.output ?? 0,
        overrides: tiers.map((tier) => ({ when: { context: { gt: tier.tier.size } }, price: tier.output })),
      },
    },
  }
}
