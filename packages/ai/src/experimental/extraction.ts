import { Effect, Schema } from "effect"
import { MediaModel, tryRequest } from "../media-model.js"
import { RequestExecutor } from "../route/executor.js"
import type { MediaRoute } from "../route/media.js"
import { AIError, HttpOptions, ProviderMetadata, ProviderOptions, Usage, type OpenString } from "../schema/index.js"

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** `[start, end)` character offsets into `input`. */
const Span = Schema.Tuple([Schema.Int, Schema.Int])

/** An ISO date for date estimates; anything else is numeric. */
const NumberOrDate = Schema.Union([Schema.Number, Schema.String])

/** `value` is null when the input does not determine it; `guess` is the most likely value either way. */
const valueAnswer = <Value extends Schema.Top>(value: Value) =>
  Schema.Struct({
    value: Schema.NullOr(value),
    guess: Schema.optional(value),
    nullProbability: Schema.optional(Schema.Number),
    confidence: Schema.optional(Schema.Number),
    span: Schema.optional(Span),
  }).pipe(Schema.encodeKeys({ nullProbability: "p_null" }))

const StringAnswer = valueAnswer(Schema.String)
const NumberAnswer = valueAnswer(Schema.Number)

/** `value` is the most likely point; `p10` to `p90` is the 80% interval. */
const EstimateAnswer = Schema.Struct({
  value: NumberOrDate,
  mean: Schema.optional(NumberOrDate),
  median: NumberOrDate,
  p10: NumberOrDate,
  p90: NumberOrDate,
  belowProbability: Schema.optional(Schema.Number),
  aboveProbability: Schema.optional(Schema.Number),
  quantiles: Schema.optional(Schema.Array(NumberOrDate)),
}).pipe(Schema.encodeKeys({ belowProbability: "p_below", aboveProbability: "p_above" }))

/**
 * The answer schema for each field type Clairic documents, decoding its wire keys (`p_null` and friends). Answers to
 * other field types pass through as sent.
 */
export const ExtractionAnswers = {
  text: StringAnswer,
  number: NumberAnswer,
  date: StringAnswer,
  time: StringAnswer,
  datetime: StringAnswer,
  duration: NumberAnswer,
  list: Schema.Struct({
    value: Schema.NullOr(Schema.Array(Schema.Union([Schema.String, Schema.Number]))),
    spans: Schema.optional(Schema.Array(Span)),
    confidence: Schema.optional(Schema.Number),
  }),
  estimate: EstimateAnswer,
  /** One estimate per step of the series. */
  forecast: Schema.Struct({ value: Schema.Array(NumberOrDate), steps: Schema.Array(EstimateAnswer) }),
}

type Answers = typeof ExtractionAnswers

export type ExtractionAnswerFor<Field extends ExtractionField> = Field["type"] extends keyof Answers
  ? Answers[Field["type"]]["Type"]
  : Readonly<Record<string, unknown>>

/** One answer per field, keyed by field name. */
export type ExtractionAnswersFor<Fields extends ExtractionFields> = {
  readonly [Name in keyof Fields]: ExtractionAnswerFor<Fields[Name]>
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/** Options beyond these, such as `unit`, `decimals`, `items`, `min` or `max`, go to the host as written. */
const ExtractionFieldSchema = Schema.StructWithRest(
  Schema.Struct({
    type: Schema.String,
    instructions: Schema.optional(Schema.String),
    /** Probability of null above which the value is null; the host's default is 0.5. */
    nullThreshold: Schema.optional(Schema.Number),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
export type ExtractionField = typeof ExtractionFieldSchema.Type & { readonly type: OpenString<keyof Answers> }
export type ExtractionFields = Readonly<Record<string, ExtractionField>>

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type ExtractionOptions = MediaModel.Options

export type ExtractionRoute = MediaRoute.InlineRoute<ExtractionRequestFor, ExtractionResponse>

export class ExtractionModel<Options extends ExtractionOptions = ExtractionOptions> extends MediaModel<
  ExtractionRoute,
  Options
> {
  declare protected readonly _ExtractionModel: void
}

export type ExtractionModelOptions<Model> = Model extends ExtractionModel<infer Options> ? Options : never

// ---------------------------------------------------------------------------
// Request and response
// ---------------------------------------------------------------------------

export class ExtractionRequest extends Schema.Class<ExtractionRequest>("Extraction.Request")({
  model: Schema.declare((value): value is ExtractionModel => value instanceof ExtractionModel, {
    expected: "Extraction.Model",
  }),
  /** The text to read; text answers carry spans into it. */
  input: Schema.String,
  fields: Schema.Record(Schema.String, ExtractionFieldSchema).pipe(
    Schema.refine((x): x is typeof x => Object.keys(x).length > 0, { message: "Extraction fields must not be empty" }),
  ),
  /** ISO date that anchors dates written without a year. */
  referenceDate: Schema.optional(Schema.String),
  providerOptions: Schema.optional(ProviderOptions),
  http: Schema.optional(HttpOptions),
}) {
  declare protected readonly _ExtractionRequest: void
}

export type ExtractionRequestFor<
  Options extends ExtractionOptions = ExtractionOptions,
  Fields extends ExtractionFields = ExtractionFields,
> = Omit<ExtractionRequest, "model" | "fields" | "providerOptions"> & {
  readonly model: ExtractionModel<Options>
  readonly fields: Fields
  readonly providerOptions?: Options
}

export type ExtractionRequestInput<
  Model extends ExtractionModel = ExtractionModel,
  Fields extends ExtractionFields = ExtractionFields,
> = {
  readonly model: Model
  readonly input: string
  readonly fields: Fields
  readonly referenceDate?: string
  readonly providerOptions?: NoInfer<ExtractionModelOptions<Model>>
  readonly http?: HttpOptions.Input
}

export class ExtractionResponse extends Schema.Class<ExtractionResponse>("Extraction.Response")({
  answers: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)),
  usage: Schema.optional(Usage),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {}

export type ExtractionResponseFor<Fields extends ExtractionFields> = Omit<ExtractionResponse, "answers"> & {
  readonly answers: ExtractionAnswersFor<Fields>
}

// ---------------------------------------------------------------------------
// Call API
// ---------------------------------------------------------------------------

export function request<const Model extends ExtractionModel, const Fields extends ExtractionFields>(
  input: ExtractionRequestInput<Model, Fields>,
): ExtractionRequestFor<ExtractionModelOptions<Model>, Fields>
export function request(input: ExtractionRequest): ExtractionRequest
export function request(input: ExtractionRequest | ExtractionRequestInput): ExtractionRequest
export function request(input: ExtractionRequest | ExtractionRequestInput) {
  if (input instanceof ExtractionRequest) return input
  return new ExtractionRequest({ ...input, http: HttpOptions.make(input.http) })
}

export function generate<const Model extends ExtractionModel, const Fields extends ExtractionFields>(
  input: ExtractionRequestInput<Model, Fields>,
): Effect.Effect<ExtractionResponseFor<Fields>, AIError, RequestExecutor.Service>
export function generate(input: ExtractionRequest): Effect.Effect<ExtractionResponse, AIError, RequestExecutor.Service>
export function generate(input: ExtractionRequest | ExtractionRequestInput) {
  return Effect.gen(function* () {
    const executor = yield* RequestExecutor.Service
    const built = yield* tryRequest(() => request(input))
    return yield* built.model.route.generate(built, executor.execute)
  })
}

export const Extraction = {
  request,
  generate,
} as const
