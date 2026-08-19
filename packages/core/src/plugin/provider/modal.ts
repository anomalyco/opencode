import { Money } from "@opencode-ai/schema/money"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect, Schema, Semaphore, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Catalog } from "../../catalog.js"
import { Integration } from "../../integration.js"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"

const providerID = Provider.ID.make("modal")

const ReasoningOption = Schema.Struct({
  type: Schema.Literal("effort"),
  values: Schema.Array(Schema.NullOr(Schema.String)),
})

const Response = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      base_model_id: Schema.optional(Schema.String),
      hugging_face_id: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
      input_modalities: Schema.optional(Schema.Array(Schema.String)),
      output_modalities: Schema.optional(Schema.Array(Schema.String)),
      context_length: Schema.optional(Schema.Number),
      max_output_length: Schema.optional(Schema.Number),
      pricing: Schema.optional(
        Schema.Struct({
          prompt: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
          completion: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
          input_cache_read: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
        }),
      ),
      supported_features: Schema.optional(Schema.Array(Schema.String)),
      reasoning_options: Schema.optional(Schema.Array(ReasoningOption)),
      interleaved: Schema.optional(
        Schema.Union([
          Schema.Boolean,
          Schema.Struct({ field: Schema.Literals(["reasoning", "reasoning_content", "reasoning_details"]) }),
        ]),
      ),
    }),
  ),
})

const decode = Schema.decodeUnknownSync(Response)

export const ModalPlugin = define({
  id: "opencode.provider.modal",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const catalog = yield* Catalog.Service
    const loading = Semaphore.makeUnsafe(1)
    let templates: Map<Model.ID, Model.Info> | undefined
    let models: Map<Model.ID, Model.Info> | undefined

    const load = Effect.fn("ModalPlugin.load")(function* () {
      const existing =
        templates ??
        new Map(
          (yield* catalog.model.all())
            .filter((model) => model.providerID === providerID)
            .map((model) => [model.id, model]),
        )
      templates = existing
      const connection = yield* ctx.integration.connection.active("modal")
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.catch(() => Effect.succeed(undefined)))
        : undefined
      const provider = yield* catalog.provider.get(providerID)
      const baseURL = typeof provider?.settings?.baseURL === "string" ? provider.settings.baseURL : undefined
      if (credential?.type !== "key" || !baseURL) {
        models = new Map()
        return
      }

      models = yield* Effect.tryPromise({
        try: () => discover(baseURL, credential.key, existing),
        catch: (cause) => cause,
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to sync Modal models", { cause }).pipe(Effect.as(new Map<Model.ID, Model.Info>())),
        ),
      )
    })

    yield* ctx.catalog.transform((draft) => {
      if (!models) return
      const provider = draft.provider.get(providerID)
      if (!provider) return
      for (const id of provider.models.keys()) {
        if (!models.has(Model.ID.make(id))) draft.model.remove(providerID, Model.ID.make(id))
      }
      for (const [id, model] of models) {
        draft.model.update(providerID, id, (item) => Object.assign(item, structuredClone(model)))
      }
    })
    const refresh = () => loading.withPermit(load().pipe(Effect.andThen(ctx.catalog.reload())))
    yield* bus.subscribe(Integration.Event.ConnectionUpdated).pipe(
      Stream.filter((event) => event.data.integrationID === Integration.ID.make("modal")),
      Stream.runForEach(refresh),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh().pipe(Effect.forkScoped)
  }),
})

async function discover(baseURL: string, apiKey: string, templates: ReadonlyMap<Model.ID, Model.Info>) {
  const response = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(3_000),
  })
  if (!response.ok) throw new Error(`Failed to fetch Modal models: ${response.status}`)

  return new Map(
    decode(await response.json()).data.map((item) => {
      const id = Model.ID.make(item.id)
      const template = templates.get(Model.ID.make(item.base_model_id ?? item.hugging_face_id ?? item.id))
      return [id, build(id, item, baseURL, template)]
    }),
  )
}

function build(id: Model.ID, item: (typeof Response.Type)["data"][number], baseURL: string, template?: Model.Info) {
  const fallback: Model.Info = template ?? Model.Info.make(Model.Info.default(providerID, id))
  const baseCost = fallback.cost[0]
  const variants = item.reasoning_options?.flatMap((option) =>
    option.values.map((value) => {
      const effort = value ?? "none"
      return {
        id: Model.VariantID.make(effort),
        settings: { reasoningEffort: effort },
      }
    }),
  )
  return Model.Info.make({
    ...structuredClone(fallback),
    id,
    modelID: id,
    providerID,
    name: item.name ?? fallback.name,
    compatibility: Model.compatibility(item.interleaved) ?? fallback.compatibility,
    package: fallback.package ?? Provider.aisdk("@ai-sdk/openai-compatible"),
    settings: Provider.mergeOverlay(fallback.settings, { baseURL }),
    capabilities: {
      tools: item.supported_features?.includes("tools") ?? fallback.capabilities.tools,
      input: item.input_modalities ? [...item.input_modalities] : [...fallback.capabilities.input],
      output: item.output_modalities ? [...item.output_modalities] : [...fallback.capabilities.output],
    },
    variants: variants ?? [...fallback.variants],
    cost: [
      {
        input: price(item.pricing?.prompt, baseCost?.input ?? Money.USDPerMillionTokens.zero),
        output: price(item.pricing?.completion, baseCost?.output ?? Money.USDPerMillionTokens.zero),
        cache: {
          read: price(item.pricing?.input_cache_read, baseCost?.cache.read ?? Money.USDPerMillionTokens.zero),
          write: baseCost?.cache.write ?? Money.USDPerMillionTokens.zero,
        },
      },
    ],
    limit: {
      context: item.context_length ?? fallback.limit.context,
      input: fallback.limit.input,
      output: item.max_output_length ?? fallback.limit.output,
    },
    status: fallback.status,
    enabled: fallback.enabled,
  })
}

function price(value: string | number | undefined, fallback: number) {
  if (value === undefined) return Money.USDPerMillionTokens.make(fallback)
  const parsed = Number(value)
  return Money.USDPerMillionTokens.make(Number.isFinite(parsed) ? parsed * 1_000_000 : fallback)
}
