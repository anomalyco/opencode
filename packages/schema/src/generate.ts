export * as Generate from "./generate.js"

import { Schema } from "effect"
import { Model } from "./model.js"
import { Money } from "./money.js"
import { Base64 } from "./prompt.js"
import { PositiveInt, optional } from "./schema.js"

const description = (text: string) => ({ description: text })

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export interface File extends Schema.Schema.Type<typeof File> {}
export const File = Schema.Struct({
  data: Base64,
  mime: Schema.String,
  name: Schema.String.pipe(optional),
}).annotate({ identifier: "Generate.File" })

export interface Usage extends Schema.Schema.Type<typeof Usage> {}
export const Usage = Schema.Struct({
  input: Schema.Finite.pipe(optional),
  output: Schema.Finite.pipe(optional),
}).annotate({ identifier: "Generate.Usage", description: "Token counts, when the provider reports them" })

export const Native = Schema.Record(Schema.String, Schema.Unknown).annotate({
  identifier: "Generate.Native",
  description: "Provider-specific data the shared fields do not cover",
})
export type Native = typeof Native.Type

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

export type ImageAspect = `${number}:${number}`
// The template literal gives clients the type; the pattern also rejects signs and exponents it would allow.
export const ImageAspect: Schema.Codec<ImageAspect> = Schema.TemplateLiteral([Schema.Number, ":", Schema.Number])
  .check(Schema.isPattern(/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/))
  .annotate({ identifier: "Generate.ImageAspect", description: "Aspect ratio as width:height, for example 16:9" })

/** Open-ended: providers add size tiers beyond these. */
export type ImageResolution = "1K" | "2K" | "4K" | (string & {})
export const ImageResolution: Schema.Codec<ImageResolution> = Schema.Union([
  Schema.Literals(["1K", "2K", "4K"]),
  Schema.String,
]).annotate({
  identifier: "Generate.ImageResolution",
  description: "Size tier such as 1K, 2K or 4K; 1K is about as many pixels as 1024x1024 at the requested aspect",
})

export interface ImageRequest extends Schema.Schema.Type<typeof ImageRequest> {}
export const ImageRequest = Schema.Struct({
  model: Model.Ref,
  prompt: Schema.String,
  images: Schema.Array(File)
    .pipe(optional)
    .annotate(description("Edit sources or style and subject references, in order")),
  n: PositiveInt.pipe(optional).annotate(description("Number of images to generate; defaults to 1")),
  aspect: ImageAspect.pipe(optional),
  resolution: ImageResolution.pipe(optional),
}).annotate({ identifier: "Generate.ImageRequest" })

export interface ImageOutput extends Schema.Schema.Type<typeof ImageOutput> {}
export const ImageOutput = Schema.Struct({
  type: Schema.Literal("image"),
  ...File.fields,
}).annotate({ identifier: "Generate.ImageOutput" })

export interface ImageResult extends Schema.Schema.Type<typeof ImageResult> {}
export const ImageResult = Schema.Struct({
  images: Schema.Array(ImageOutput),
  cost: Money.USD.pipe(optional),
  tokens: Usage.pipe(optional),
  native: Native.pipe(optional),
}).annotate({ identifier: "Generate.ImageResult" })

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export interface DecisionTextPart extends Schema.Schema.Type<typeof DecisionTextPart> {}
export const DecisionTextPart = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }).annotate({
  identifier: "Generate.DecisionTextPart",
})

export interface DecisionJsonPart extends Schema.Schema.Type<typeof DecisionJsonPart> {}
export const DecisionJsonPart = Schema.Struct({ type: Schema.Literal("json"), value: Schema.Json }).annotate({
  identifier: "Generate.DecisionJsonPart",
})

export interface DecisionFilePart extends Schema.Schema.Type<typeof DecisionFilePart> {}
export const DecisionFilePart = Schema.Struct({
  type: Schema.Literal("file"),
  ...File.fields,
}).annotate({ identifier: "Generate.DecisionFilePart" })

export type DecisionPart = DecisionTextPart | DecisionJsonPart | DecisionFilePart
export const DecisionPart = Schema.Union([DecisionTextPart, DecisionJsonPart, DecisionFilePart]).annotate({
  identifier: "Generate.DecisionPart",
})

export const ChoiceValue = Schema.Union([Schema.String, Schema.Boolean]).annotate({
  identifier: "Generate.ChoiceValue",
  description: 'Choice values are typed: true and "true" are different values',
})
export type ChoiceValue = typeof ChoiceValue.Type

const QuestionName = Schema.String.annotate(description("Unique within the request; echoed on the matching answer"))

export interface PredicateQuestion extends Schema.Schema.Type<typeof PredicateQuestion> {}
export const PredicateQuestion = Schema.Struct({
  type: Schema.Literal("predicate"),
  name: QuestionName,
  instructions: Schema.String,
}).annotate({ identifier: "Generate.PredicateQuestion", description: "The probability that a statement is true" })

export interface ChoiceQuestion extends Schema.Schema.Type<typeof ChoiceQuestion> {}
export const ChoiceQuestion = Schema.Struct({
  type: Schema.Literal("choice"),
  name: QuestionName,
  instructions: Schema.String,
  choices: Schema.Array(Schema.Struct({ value: ChoiceValue, description: Schema.String.pipe(optional) })).check(
    Schema.isMinLength(1),
  ),
}).annotate({ identifier: "Generate.ChoiceQuestion", description: "Pick one value from a fixed set" })

export interface ScoreQuestion extends Schema.Schema.Type<typeof ScoreQuestion> {}
export const ScoreQuestion = Schema.Struct({
  type: Schema.Literal("score"),
  name: QuestionName,
  instructions: Schema.String,
  levels: Schema.Array(Schema.Struct({ label: Schema.String, description: Schema.String.pipe(optional) })).check(
    Schema.isMinLength(1),
  ),
}).annotate({ identifier: "Generate.ScoreQuestion", description: "Place the input on ordered levels, lowest first" })

export type DecisionQuestion = PredicateQuestion | ChoiceQuestion | ScoreQuestion
export const DecisionQuestion = Schema.Union([PredicateQuestion, ChoiceQuestion, ScoreQuestion]).annotate({
  identifier: "Generate.DecisionQuestion",
})

export interface DecisionRequest extends Schema.Schema.Type<typeof DecisionRequest> {}
export const DecisionRequest = Schema.Struct({
  model: Model.Ref,
  input: Schema.Array(DecisionPart).annotate(description("The evidence every question is asked about, in order")),
  questions: Schema.Array(DecisionQuestion)
    .check(Schema.isMinLength(1))
    .annotate(description("Question names must be unique; duplicates fail with InvalidRequestError")),
}).annotate({ identifier: "Generate.DecisionRequest" })

const Probability = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

export interface PredicateAnswer extends Schema.Schema.Type<typeof PredicateAnswer> {}
export const PredicateAnswer = Schema.Struct({
  type: Schema.Literal("predicate"),
  name: Schema.String,
  probability: Probability,
}).annotate({ identifier: "Generate.PredicateAnswer" })

export interface ChoiceAnswer extends Schema.Schema.Type<typeof ChoiceAnswer> {}
export const ChoiceAnswer = Schema.Struct({
  type: Schema.Literal("choice"),
  name: Schema.String,
  choice: ChoiceValue,
  probabilities: Schema.Array(Schema.Struct({ value: ChoiceValue, probability: Probability })),
  confidence: Probability,
}).annotate({ identifier: "Generate.ChoiceAnswer" })

export interface ScoreAnswer extends Schema.Schema.Type<typeof ScoreAnswer> {}
export const ScoreAnswer = Schema.Struct({
  type: Schema.Literal("score"),
  name: Schema.String,
  score: Schema.Finite.annotate(description("Probability-weighted level index, so it can fall between levels")),
  probabilities: Schema.Array(Schema.Struct({ value: Schema.Int, label: Schema.String, probability: Probability })),
  confidence: Probability,
}).annotate({ identifier: "Generate.ScoreAnswer" })

export interface ErrorAnswer extends Schema.Schema.Type<typeof ErrorAnswer> {}
export const ErrorAnswer = Schema.Struct({
  type: Schema.Literal("error"),
  name: Schema.String,
  reason: Schema.String.annotate(description("Why the question has no answer, for example refusal")),
  message: Schema.String.pipe(optional),
}).annotate({
  identifier: "Generate.ErrorAnswer",
  description: "This one question has no answer; the other answers still came back",
})

export type DecisionAnswer = PredicateAnswer | ChoiceAnswer | ScoreAnswer | ErrorAnswer
export const DecisionAnswer = Schema.Union([PredicateAnswer, ChoiceAnswer, ScoreAnswer, ErrorAnswer]).annotate({
  identifier: "Generate.DecisionAnswer",
})

export interface DecisionResult extends Schema.Schema.Type<typeof DecisionResult> {}
export const DecisionResult = Schema.Struct({
  answers: Schema.Array(DecisionAnswer).annotate(description("One answer per question, in question order")),
  cost: Money.USD.pipe(optional),
  tokens: Usage.pipe(optional),
  native: Native.pipe(optional),
}).annotate({ identifier: "Generate.DecisionResult" })
