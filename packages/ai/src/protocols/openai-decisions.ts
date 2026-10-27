import { Effect, Schema } from "effect"
import { DecisionResponse, DecisionUsage, type DecisionAnswer, type DecisionPart, type DecisionRequestFor } from "../decision.js"
import { DecisionRoute } from "../route/decision.js"
import { Endpoint } from "../route/endpoint.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { AIError, UnsupportedOperationError, mergeJsonRecords, type ProviderOptions } from "../schema/index.js"
import { encodeJson } from "../utils/json.js"
import { OpenResponses } from "./open-responses.js"
import { ProviderShared } from "./shared.js"

const ID = "openai-decisions"
const NAME = "OpenAI Decisions"
export const DEFAULT_BASE_URL = "https://api.openai.com/v1"
export const PATH = "/decisions"

const Options = Schema.Struct({
  promptCacheKey: Schema.optional(Schema.String),
  promptCacheOptions: Schema.optional(
    Schema.Struct({ mode: Schema.optional(Schema.String), ttl: Schema.optional(Schema.String) }),
  ),
  safetyIdentifier: Schema.optional(Schema.String),
})
/** Known fields map to their wire names; anything else is sent as given. */
export type OptionsInput = ProviderOptions & typeof Options.Encoded

const Probability = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const ChoiceValue = Schema.Union([Schema.String, Schema.Boolean])
const Answer = Schema.Union([
  Schema.Struct({ type: Schema.Literal("predicate"), name: Schema.String, probability: Probability }),
  Schema.Struct({
    type: Schema.Literal("choice"),
    name: Schema.String,
    choice: ChoiceValue,
    probabilities: Schema.Array(Schema.Struct({ value: ChoiceValue, probability: Probability })),
    confidence: Probability,
  }),
  Schema.Struct({
    type: Schema.Literal("score"),
    name: Schema.String,
    score: Schema.Number,
    probabilities: Schema.Array(Schema.Struct({ value: Schema.Int, label: Schema.String, probability: Probability })),
    confidence: Probability,
  }),
  Schema.Struct({ type: Schema.Literal("refusal"), name: Schema.String, message: Schema.optional(Schema.String) }),
])
const Response = Schema.Struct({
  model: Schema.String,
  answers: Schema.Array(Answer),
  usage: Schema.optional(OpenResponses.OpenResponsesUsage),
})

const decodeOptions = ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))

const fromRequest = Effect.fn("OpenAIDecisions.fromRequest")(function* (request: DecisionRequestFor) {
  const options = yield* decodeOptions(request.providerOptions ?? {})
  const { promptCacheKey: _, promptCacheOptions: __, safetyIdentifier: ___, ...native } = request.providerOptions ?? {}
  return {
    ...mergeJsonRecords(
      {
        prompt_cache_key: options.promptCacheKey,
        prompt_cache_options: options.promptCacheOptions,
        safety_identifier: options.safetyIdentifier,
        ...native,
      },
      request.http?.body,
    ),
    model: request.model.id,
    input: [{ role: "user", content: yield* Effect.forEach(request.input, (part) => inputPart(request, part)) }],
    questions: request.questions,
  }
})

// `input_json` takes an object or a list of objects; other JSON values go as text.
const inputPart = (
  request: DecisionRequestFor,
  part: DecisionPart,
): Effect.Effect<Record<string, unknown>, AIError> => {
  if (part.type === "text") return Effect.succeed({ type: "input_text", text: part.text })
  if (part.type === "json")
    return Effect.succeed(
      isObject(part.value) || (Array.isArray(part.value) && part.value.every(isObject))
        ? { type: "input_json", data: part.value }
        : { type: "input_text", text: encodeJson(part.value) },
    )
  if (part.media.kind !== "image")
    return Effect.fail(
      new AIError({
        reason: new UnsupportedOperationError({
          operation: "decision.media",
          provider: request.model.provider,
          route: request.model.route.id,
          message: `${NAME} takes images only; got ${part.media.kind} media`,
        }),
      }),
    )
  return ProviderShared.mediaReference(part.media, undefined, `${NAME} image input`).pipe(
    Effect.map((reference) => ({ type: "input_image", image_url: reference.value })),
  )
}

const isObject = (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value)

const decodeDocument = MediaProtocol.identity({ id: ID, name: NAME, provider: "openai" }).decodeJson(Response)

export const protocol = DecisionRoute.protocol({
  id: ID,
  name: NAME,
  body: { from: fromRequest },
  response: {
    decode: Effect.fn("OpenAIDecisions.decodeResponse")(function* (response, context) {
      const output = yield* decodeDocument(response)
      const answers = output.value.answers.map(
        (answer): DecisionAnswer =>
          answer.type === "refusal"
            ? {
                name: answer.name,
                type: "error",
                reason: "refusal",
                ...(answer.message === undefined ? {} : { message: answer.message }),
              }
            : answer,
      )
      const byName = new Map(answers.map((answer) => [answer.name, answer]))
      const ordered = context.request.questions.flatMap((question) => byName.get(question.name) ?? [])
      const usage = OpenResponses.mapUsage(output.value.usage, context.providerMetadataKey)
      return new DecisionResponse({
        answers: ordered.length === answers.length ? ordered : answers,
        usage:
          usage === undefined
            ? undefined
            : new DecisionUsage({
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
                cost: usage.cost,
              }),
        providerMetadata: {
          [context.providerMetadataKey]: {
            model: output.value.model,
            ...(output.value.usage === undefined ? {} : { usage: output.value.usage }),
          },
        },
      })
    }),
  },
})

export const route = DecisionRoute.make({
  id: ID,
  provider: "openai",
  protocol,
  endpoint: Endpoint.path(PATH, { baseURL: DEFAULT_BASE_URL }),
})

export const OpenAIDecisions = {
  protocol,
  route,
} as const
