import { Effect, Schema } from "effect"
import {
  AIError,
  HttpOptions,
  InvalidRequestError,
  ModelID,
  ProviderID,
  ProviderMetadata,
  Usage,
} from "../schema/index.js"
import { EvaluationClient, Service, type Execute } from "./evaluation-client.js"

export const EvaluationInput = Schema.Union([Schema.String, Schema.JsonObject, Schema.Array(Schema.Json)])
export type EvaluationInput = Schema.Schema.Type<typeof EvaluationInput>

const EvaluationCriterion = Schema.NullOr(EvaluationInput)
const ChoiceCriteria = Schema.Record(Schema.String, EvaluationCriterion).pipe(
  Schema.refine((x): x is typeof x => Object.keys(x).length > 0, {
    message: "Choice criteria must be a nonempty option map",
  }),
)

export const ChoiceQuestion = Schema.Struct({
  type: Schema.Literal("choice"),
  instructions: EvaluationInput,
  criteria: ChoiceCriteria,
})
export type ChoiceQuestion = Schema.Schema.Type<typeof ChoiceQuestion>

export const ScoreQuestion = Schema.Struct({
  type: Schema.Literal("score"),
  instructions: EvaluationInput,
  criteria: Schema.Array(EvaluationCriterion).check(Schema.isMinLength(2)),
})
export type ScoreQuestion = Schema.Schema.Type<typeof ScoreQuestion>

export const BooleanQuestion = Schema.Struct({
  type: Schema.Literal("boolean"),
  instructions: EvaluationInput,
  criteria: Schema.optional(
    Schema.Struct({
      true: Schema.optional(EvaluationCriterion),
      false: Schema.optional(EvaluationCriterion),
    }),
  ),
})
export type BooleanQuestion = Schema.Schema.Type<typeof BooleanQuestion>

export const EvaluationQuestion = Schema.Union([ChoiceQuestion, ScoreQuestion, BooleanQuestion]).pipe(
  Schema.toTaggedUnion("type"),
)
export type EvaluationQuestion = Schema.Schema.Type<typeof EvaluationQuestion>
export type EvaluationQuestions = Readonly<Record<string, EvaluationQuestion>>
const EvaluationQuestions = Schema.Record(Schema.String, EvaluationQuestion).pipe(
  Schema.refine((x): x is typeof x => Object.keys(x).length > 0, {
    message: "Evaluation questions must be a nonempty map",
  }),
)

const Probability = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

export const ChoiceAnswer = Schema.Struct({
  type: Schema.Literal("choice"),
  choice: Schema.String,
  probabilities: Schema.optional(Schema.Record(Schema.String, Probability)),
})
export type ChoiceAnswer = Schema.Schema.Type<typeof ChoiceAnswer>

export const ScoreAnswer = Schema.Struct({
  type: Schema.Literal("score"),
  score: Schema.Number,
  probabilities: Schema.optional(Schema.Record(Schema.String, Probability)),
})
export type ScoreAnswer = Schema.Schema.Type<typeof ScoreAnswer>

export const BooleanAnswer = Schema.Struct({
  type: Schema.Literal("boolean"),
  probability: Probability,
})
export type BooleanAnswer = Schema.Schema.Type<typeof BooleanAnswer>

export const EvaluationAnswer = Schema.Union([ChoiceAnswer, ScoreAnswer, BooleanAnswer]).pipe(
  Schema.toTaggedUnion("type"),
)
export type EvaluationAnswer = Schema.Schema.Type<typeof EvaluationAnswer>

export type AnswerFor<Question extends EvaluationQuestion> = Question extends {
  readonly type: "choice"
  readonly criteria: infer Criteria
}
  ? {
      readonly type: "choice"
      readonly choice: Extract<keyof Criteria, string>
      readonly probabilities?: Readonly<Record<Extract<keyof Criteria, string>, number>>
    }
  : Question extends { readonly type: "score" }
    ? ScoreAnswer
    : BooleanAnswer

export type AnswersFor<Questions extends EvaluationQuestions> = {
  readonly [ID in keyof Questions]: AnswerFor<Questions[ID]>
}

export type EvaluationOptions = Record<string, unknown>

export interface EvaluationRoute<Options extends EvaluationOptions = EvaluationOptions> {
  readonly id: string
  readonly evaluate: (
    request: EvaluationRequestFor<Options>,
    execute: Execute,
  ) => Effect.Effect<EvaluationResponse, AIError>
}

export class EvaluationModel<Options extends EvaluationOptions = EvaluationOptions> {
  declare protected readonly _Options: (options: Options) => Options
  readonly id: ModelID
  readonly provider: ProviderID
  readonly route: EvaluationRoute<Options>
  readonly http?: HttpOptions

  constructor(input: EvaluationModel.Input<Options>) {
    this.id = input.id
    this.provider = input.provider
    this.route = input.route
    this.http = input.http
  }

  static make<Options extends EvaluationOptions = EvaluationOptions>(input: EvaluationModel.MakeInput<Options>) {
    return new EvaluationModel<Options>({
      id: ModelID.make(input.id),
      provider: ProviderID.make(input.provider),
      route: input.route,
      http: input.http,
    })
  }
}

export namespace EvaluationModel {
  export interface Input<Options extends EvaluationOptions = EvaluationOptions> {
    readonly id: ModelID
    readonly provider: ProviderID
    readonly route: EvaluationRoute<Options>
    readonly http?: HttpOptions
  }

  export interface MakeInput<Options extends EvaluationOptions = EvaluationOptions>
    extends Omit<Input<Options>, "id" | "provider"> {
    readonly id: string | ModelID
    readonly provider: string | ProviderID
  }
}

export const EvaluationModelSchema = Schema.declare(
  (value): value is EvaluationModel => value instanceof EvaluationModel,
  {
    expected: "Evaluation.Model",
  },
)

export class EvaluationRequest extends Schema.Class<EvaluationRequest>("Evaluation.Request")({
  model: EvaluationModelSchema,
  state: EvaluationInput,
  questions: EvaluationQuestions,
  options: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  http: Schema.optional(HttpOptions),
}) {
  declare protected readonly _EvaluationRequest: void
}

export type EvaluationModelOptions<Model> = Model extends EvaluationModel<infer Options> ? Options : never

export type EvaluationRequestFor<
  Options extends EvaluationOptions = EvaluationOptions,
  Questions extends EvaluationQuestions = EvaluationQuestions,
> = Omit<EvaluationRequest, "model" | "questions" | "options"> & {
  readonly model: EvaluationModel<Options>
  readonly questions: Questions
  readonly options?: Options
}

export type EvaluationRequestInput<
  Model extends object = EvaluationModel,
  Questions extends EvaluationQuestions = EvaluationQuestions,
> = Omit<ConstructorParameters<typeof EvaluationRequest>[0], "model" | "questions" | "options" | "http"> & {
  readonly model: Model
  readonly questions: Questions
  readonly options?: NoInfer<EvaluationModelOptions<Model>>
  readonly http?: HttpOptions.Input
} & (Model extends EvaluationModel<EvaluationModelOptions<Model>> ? unknown : never)

export class EvaluationRounding extends Schema.Class<EvaluationRounding>("Evaluation.Rounding")({
  probabilityDecimals: Schema.optional(Schema.Int),
  scoreDecimals: Schema.optional(Schema.Int),
}) {}

export class EvaluationResponse extends Schema.Class<EvaluationResponse>("Evaluation.Response")({
  model: ModelID,
  answers: Schema.Record(Schema.String, EvaluationAnswer),
  usage: Schema.optional(Usage),
  rounding: Schema.optional(EvaluationRounding),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {}

export type EvaluationResponseFor<Questions extends EvaluationQuestions> = Omit<EvaluationResponse, "answers"> & {
  readonly answers: AnswersFor<Questions>
}

export function request<const Model extends object, const Questions extends EvaluationQuestions>(
  input: EvaluationRequestInput<Model, Questions>,
): EvaluationRequestFor<EvaluationModelOptions<Model>, Questions>
export function request(input: EvaluationRequest): EvaluationRequest
export function request(input: EvaluationRequest | EvaluationRequestInput) {
  if (input instanceof EvaluationRequest) return input
  return new EvaluationRequest({
    ...input,
    model: input.model as unknown as EvaluationModel,
    http: input.http === undefined ? undefined : HttpOptions.make(input.http),
  })
}

export function run<const Model extends object, const Questions extends EvaluationQuestions>(
  input: EvaluationRequestInput<Model, Questions>,
): Effect.Effect<EvaluationResponseFor<Questions>, AIError, Service>
export function run(input: EvaluationRequest): Effect.Effect<EvaluationResponse, AIError, Service>
export function run(input: EvaluationRequest | EvaluationRequestInput) {
  return Effect.try({
    try: () => (input instanceof EvaluationRequest ? input : request(input)),
    catch: (cause) =>
      new AIError({
        reason: new InvalidRequestError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
      }),
  }).pipe(
    Effect.flatMap((request) =>
      EvaluationClient.evaluate(request as EvaluationRequestFor<EvaluationOptions, EvaluationQuestions>),
    ),
  )
}

export const Evaluation = {
  request,
  run,
} as const
