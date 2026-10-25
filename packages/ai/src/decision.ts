import { Effect, Schema } from "effect"
import { DecisionClient, Service, type Execute } from "./decision-client.js"
import { Media } from "./media.js"
import { tryRequest } from "./media-model.js"
import { AIError, HttpOptions, ModelID, ProviderID, ProviderMetadata, ProviderOptions, Usage } from "./schema/index.js"

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const DecisionTextPart = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })
export const DecisionJsonPart = Schema.Struct({ type: Schema.Literal("json"), value: Schema.Json })
export const DecisionMediaPart = Schema.Struct({
  type: Schema.Literal("media"),
  media: Media.AssetSchema,
  filename: Schema.optional(Schema.String),
})
export const DecisionPart = Schema.Union([DecisionTextPart, DecisionJsonPart, DecisionMediaPart]).pipe(
  Schema.toTaggedUnion("type"),
)
export type DecisionPart = Schema.Schema.Type<typeof DecisionPart>

/** A plain object is one `json` part. */
export type DecisionInput = typeof Schema.JsonObject.Type | ReadonlyArray<DecisionPart>

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/** Choice values are typed: `true` and `"true"` are different values. */
export const ChoiceValue = Schema.Union([Schema.String, Schema.Boolean])
export type ChoiceValue = Schema.Schema.Type<typeof ChoiceValue>

export const PredicateQuestion = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("predicate"),
  instructions: Schema.String,
})
export type PredicateQuestion = Schema.Schema.Type<typeof PredicateQuestion>

export const ChoiceQuestion = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("choice"),
  instructions: Schema.String,
  choices: Schema.Array(Schema.Struct({ value: ChoiceValue, description: Schema.optional(Schema.String) })),
})
export type ChoiceQuestion = Schema.Schema.Type<typeof ChoiceQuestion>

export const ScoreQuestion = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("score"),
  instructions: Schema.String,
  levels: Schema.Array(Schema.Struct({ label: Schema.String, description: Schema.optional(Schema.String) })),
})
export type ScoreQuestion = Schema.Schema.Type<typeof ScoreQuestion>

export const DecisionQuestion = Schema.Union([PredicateQuestion, ChoiceQuestion, ScoreQuestion]).pipe(
  Schema.toTaggedUnion("type"),
)
export type DecisionQuestion = Schema.Schema.Type<typeof DecisionQuestion>
export type DecisionQuestions = ReadonlyArray<DecisionQuestion>

// Only what makes a request meaningless is checked here; counts and sizes are the host's to enforce.
const DecisionQuestionList = Schema.Array(DecisionQuestion).pipe(
  Schema.refine((x): x is typeof x => x.length > 0, { message: "Decision questions must not be empty" }),
  Schema.refine((x): x is typeof x => new Set(x.map((question) => question.name)).size === x.length, {
    message: "Decision question names must be unique",
  }),
)

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

const Probability = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

export const PredicateAnswer = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("predicate"),
  probability: Probability,
})
export type PredicateAnswer = Schema.Schema.Type<typeof PredicateAnswer>

export const ChoiceAnswer = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("choice"),
  choice: ChoiceValue,
  probabilities: Schema.Array(Schema.Struct({ value: ChoiceValue, probability: Probability })),
  confidence: Probability,
})
export type ChoiceAnswer = Schema.Schema.Type<typeof ChoiceAnswer>

/** `score` is the probability-weighted level index; `probabilities` has one entry per level. */
export const ScoreAnswer = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("score"),
  score: Schema.Number,
  probabilities: Schema.Array(Schema.Struct({ value: Schema.Int, label: Schema.String, probability: Probability })),
  confidence: Probability,
})
export type ScoreAnswer = Schema.Schema.Type<typeof ScoreAnswer>

/** The host declined this one question; the other answers still came back. */
export const ErrorAnswer = Schema.Struct({
  name: Schema.String,
  type: Schema.Literal("error"),
  reason: Schema.Literal("refusal"),
})
export type ErrorAnswer = Schema.Schema.Type<typeof ErrorAnswer>

export const DecisionAnswer = Schema.Union([PredicateAnswer, ChoiceAnswer, ScoreAnswer, ErrorAnswer]).pipe(
  Schema.toTaggedUnion("type"),
)
export type DecisionAnswer = Schema.Schema.Type<typeof DecisionAnswer>

type ChoiceValueOf<Question> = Question extends { readonly choices: ReadonlyArray<{ readonly value: infer Value }> }
  ? Value
  : never

export type AnswerFor<Question extends DecisionQuestion> =
  | (Question extends { readonly type: "predicate" }
      ? PredicateAnswer & { readonly name: Question["name"] }
      : Question extends { readonly type: "choice" }
        ? {
            readonly name: Question["name"]
            readonly type: "choice"
            readonly choice: ChoiceValueOf<Question>
            readonly probabilities: ReadonlyArray<{
              readonly value: ChoiceValueOf<Question>
              readonly probability: number
            }>
            readonly confidence: number
          }
        : ScoreAnswer & { readonly name: Question["name"] })
  | (ErrorAnswer & { readonly name: Question["name"] })

/** One answer per question, in question order. */
export type AnswersFor<Questions extends DecisionQuestions> = {
  readonly [Index in keyof Questions]: AnswerFor<Questions[Index]>
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type DecisionOptions = Record<string, unknown>

/** What a decision model's route does; `DecisionRoute.make(...).model(...)` builds one from a protocol. */
export interface DecisionModelRoute<Options extends DecisionOptions = DecisionOptions> {
  readonly id: string
  generate(request: DecisionRequestFor<Options>, execute: Execute): Effect.Effect<DecisionResponse, AIError>
}

/** Host quirks a protocol adapts to, like `LanguageModelCompatibility` for language models. */
export class DecisionModelCompatibility extends Schema.Class<DecisionModelCompatibility>("Decision.ModelCompatibility")(
  {
    /**
     * Where a System One host reads media, from models.dev `[api.systemone] compatibility.image_input`:
     * `assets` (TypeSafe's assets map), `images` (top-level lists) or `state` (items inside a state list).
     */
    imageInput: Schema.optional(Schema.Literals(["assets", "images", "state"])),
  },
) {}

export namespace DecisionModelCompatibility {
  export type Input = DecisionModelCompatibility | ConstructorParameters<typeof DecisionModelCompatibility>[0]

  export const make = (input: Input) =>
    input instanceof DecisionModelCompatibility ? input : new DecisionModelCompatibility(input)
}

export class DecisionModel<Options extends DecisionOptions = DecisionOptions> {
  declare protected readonly _Options: Options
  readonly id: ModelID
  readonly provider: ProviderID
  readonly route: DecisionModelRoute<Options>
  readonly http?: HttpOptions
  readonly compatibility?: DecisionModelCompatibility

  constructor(input: DecisionModel.Input<Options>) {
    this.id = input.id
    this.provider = input.provider
    this.route = input.route
    this.http = input.http
    this.compatibility = input.compatibility
  }

  static make<Options extends DecisionOptions = DecisionOptions>(input: DecisionModel.MakeInput<Options>) {
    return new DecisionModel<Options>({
      ...input,
      id: ModelID.make(input.id),
      provider: ProviderID.make(input.provider),
    })
  }
}

export namespace DecisionModel {
  export interface Input<Options extends DecisionOptions = DecisionOptions> {
    readonly id: ModelID
    readonly provider: ProviderID
    readonly route: DecisionModelRoute<Options>
    readonly http?: HttpOptions
    readonly compatibility?: DecisionModelCompatibility
  }

  export interface MakeInput<Options extends DecisionOptions = DecisionOptions>
    extends Omit<Input<Options>, "id" | "provider"> {
    readonly id: string | ModelID
    readonly provider: string | ProviderID
  }
}

export const DecisionModelSchema = Schema.declare((value): value is DecisionModel => value instanceof DecisionModel, {
  expected: "Decision.Model",
})

export type DecisionModelOptions<Model> = Model extends DecisionModel<infer Options> ? Options : never

// ---------------------------------------------------------------------------
// Request and response
// ---------------------------------------------------------------------------

export class DecisionRequest extends Schema.Class<DecisionRequest>("Decision.Request")({
  model: DecisionModelSchema,
  input: Schema.Array(DecisionPart),
  questions: DecisionQuestionList,
  providerOptions: Schema.optional(ProviderOptions),
  http: Schema.optional(HttpOptions),
}) {
  declare protected readonly _DecisionRequest: void
}

export type DecisionRequestFor<
  Options extends DecisionOptions = DecisionOptions,
  Questions extends DecisionQuestions = DecisionQuestions,
> = Omit<DecisionRequest, "model" | "questions" | "providerOptions"> & {
  readonly model: DecisionModel<Options>
  readonly questions: Questions
  readonly providerOptions?: Options
}

export type DecisionRequestInput<
  Model extends DecisionModel = DecisionModel,
  Questions extends DecisionQuestions = DecisionQuestions,
> = {
  readonly model: Model
  readonly input: DecisionInput
  readonly questions: Questions
  readonly providerOptions?: NoInfer<DecisionModelOptions<Model>>
  readonly http?: HttpOptions.Input
}

export class DecisionResponse extends Schema.Class<DecisionResponse>("Decision.Response")({
  answers: Schema.Array(DecisionAnswer),
  usage: Schema.optional(Usage),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {}

export type DecisionResponseFor<Questions extends DecisionQuestions> = Omit<DecisionResponse, "answers"> & {
  readonly answers: AnswersFor<Questions>
}

// ---------------------------------------------------------------------------
// Call API
// ---------------------------------------------------------------------------

export function request<const Model extends DecisionModel, const Questions extends DecisionQuestions>(
  input: DecisionRequestInput<Model, Questions>,
): DecisionRequestFor<DecisionModelOptions<Model>, Questions>
export function request(input: DecisionRequest): DecisionRequest
export function request(input: DecisionRequest | DecisionRequestInput): DecisionRequest
export function request(input: DecisionRequest | DecisionRequestInput) {
  if (input instanceof DecisionRequest) return input
  return new DecisionRequest({
    ...input,
    input: Array.isArray(input.input) ? input.input : [{ type: "json", value: input.input }],
    http: HttpOptions.make(input.http),
  })
}

export function generate<const Model extends DecisionModel, const Questions extends DecisionQuestions>(
  input: DecisionRequestInput<Model, Questions>,
): Effect.Effect<DecisionResponseFor<Questions>, AIError, Service>
export function generate(input: DecisionRequest): Effect.Effect<DecisionResponse, AIError, Service>
export function generate(input: DecisionRequest | DecisionRequestInput) {
  return tryRequest(() => request(input)).pipe(Effect.flatMap(DecisionClient.generate))
}

export const Decision = {
  request,
  generate,
} as const
