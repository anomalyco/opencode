import { Effect, Schema } from "effect"
import {
  DecisionResponse,
  type DecisionAnswer,
  type DecisionModelCompatibility,
  type DecisionPart,
  type DecisionQuestion,
  type DecisionRequestFor,
} from "../decision.js"
import type { Media } from "../media.js"
import { DecisionRoute } from "../route/decision.js"
import { Endpoint } from "../route/endpoint.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { AIError, UnsupportedOperationError, Usage, mergeJsonRecords } from "../schema/index.js"
import { encodeJson } from "../utils/json.js"
import { JsonObject, ProviderShared } from "./shared.js"

export const DEFAULT_PATH = "/systemone"

export const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1"

/** `messages` is Baseten's own placement (parts in a user message inside `state.messages`), set by its provider. */
type ImageInput = NonNullable<DecisionModelCompatibility["imageInput"]> | "messages"

const Probability = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const Answer = Schema.Union([
  Schema.Struct({ type: Schema.Literal("noul"), noul: Probability }),
  Schema.Struct({
    type: Schema.Literal("choice"),
    choice: Schema.String,
    probabilities: Schema.Record(Schema.String, Probability),
    confidence: Probability,
  }),
  Schema.Struct({
    type: Schema.Literal("score"),
    score: Schema.Number,
    probabilities: Schema.Record(Schema.String, Probability),
    confidence: Probability,
  }),
]).pipe(Schema.toTaggedUnion("type"))
const NativeUsage = Schema.StructWithRest(
  Schema.Struct({
    input_tokens: Schema.optional(Schema.Number),
    output_tokens: Schema.optional(Schema.Number),
  }),
  [JsonObject],
)
export const Response = Schema.Struct({
  model: Schema.String,
  answers: Schema.Record(Schema.String, Answer),
  usage: Schema.optional(NativeUsage),
  id: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  provider_metadata: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
})
export type Response = Schema.Schema.Type<typeof Response>

const ID = "system-one"
const NAME = "System One"

/** The System One body without `model`; media goes where the model's `imageInput` says, else `fallback`. */
export const encodeBody = Effect.fn("SystemOne.encodeBody")(function* (
  request: DecisionRequestFor,
  fallback: ImageInput,
) {
  const questions = yield* encodeQuestions(request.questions)
  const placed = yield* placeMedia(request, request.model.compatibility?.imageInput ?? fallback)
  return { ...mergeJsonRecords(request.providerOptions, request.http?.body), ...placed, questions }
})

const encodeQuestions = (questions: ReadonlyArray<DecisionQuestion>) =>
  Effect.forEach(questions, (question): Effect.Effect<readonly [string, unknown], AIError> => {
    if (question.type === "predicate")
      return Effect.succeed([question.name, { type: "noul", instructions: question.instructions }] as const)
    if (question.type === "score")
      return Effect.succeed([
        question.name,
        {
          type: "score",
          instructions: question.instructions,
          criteria: question.levels.map((level) =>
            level.description === undefined ? level.label : `${level.label}: ${level.description}`,
          ),
        },
      ] as const)
    // Options are map keys, so `true` is sent as "true" and mapped back by `choiceValue`.
    const keys = question.choices.map((choice) => String(choice.value))
    if (new Set(keys).size !== keys.length)
      return Effect.fail(
        ProviderShared.invalidRequest(
          `System One choice options are strings; "${question.name}" has a boolean and a string with the same text`,
        ),
      )
    return Effect.succeed([
      question.name,
      {
        type: "choice",
        instructions: question.instructions,
        criteria: Object.fromEntries(
          question.choices.map((choice) => [String(choice.value), choice.description ?? null]),
        ),
      },
    ] as const)
  }).pipe(Effect.map(Object.fromEntries))

const placeMedia = Effect.fnUntraced(function* (request: DecisionRequestFor, imageInput: ImageInput) {
  const parts = request.input
  const unsupported = (asset: Media.Asset, accepted: string) =>
    new AIError({
      reason: new UnsupportedOperationError({
        operation: "decision.media",
        provider: request.model.provider,
        route: request.model.route.id,
        message: `${NAME} takes ${accepted} here; got ${asset.mediaType}`,
      }),
    })
  const media = parts.flatMap((part) => (part.type === "media" ? [part.media] : []))
  if (media.length === 0) return { state: state(parts.map(plain)) }
  if (imageInput === "state") return { state: yield* Effect.forEach(parts, (part) => stateItem(part, unsupported)) }
  // Chat-style content in one user message: text and JSON as text parts, media as in `state`.
  if (imageInput === "messages")
    return {
      state: {
        messages: [
          {
            role: "user",
            content: yield* Effect.forEach(parts, (part) =>
              part.type === "media"
                ? stateItem(part, unsupported)
                : Effect.succeed({ type: "text", text: part.type === "text" ? part.text : encodeJson(part.value) }),
            ),
          },
        ],
      },
    }
  if (imageInput === "images") {
    const lists = { image: "images", audio: "audio", video: "videos" } as const
    const unplaced = media.find((asset) => !Object.hasOwn(lists, asset.kind))
    if (unplaced !== undefined) return yield* unsupported(unplaced, "images, audio and video")
    const inline = yield* Effect.forEach(media, (asset) => ProviderShared.requireInlineMedia(NAME, asset))
    const fields = Object.fromEntries(
      Object.entries(lists).flatMap(([kind, field]) => {
        const items = inline.filter((_, index) => media[index].kind === kind).map((item) => item.dataUrl)
        return items.length === 0 ? [] : [[field, items]]
      }),
    )
    return { state: state(parts.filter((part) => part.type !== "media").map(plain)), ...fields }
  }
  const unplaced = media.find((asset) => asset.kind !== "image")
  if (unplaced !== undefined) return yield* unsupported(unplaced, "images")
  const inline = yield* Effect.forEach(media, (asset) => ProviderShared.requireInlineMedia(NAME, asset))
  // Every occurrence of a reference string in the body is replaced with its image, so it must not be ordinary text.
  const reference = (index: number) => `<image-${index + 1}>`
  const items = parts.reduce<{ readonly next: number; readonly values: ReadonlyArray<unknown> }>(
    (acc, part) =>
      part.type === "media"
        ? { next: acc.next + 1, values: [...acc.values, reference(acc.next)] }
        : { next: acc.next, values: [...acc.values, plain(part)] },
    { next: 0, values: [] },
  ).values
  return {
    state: items,
    assets: Object.fromEntries(
      inline.map((item, index) => [
        reference(index),
        { type: "image", format: item.mime.slice("image/".length), data_base64: item.base64 },
      ]),
    ),
  }
})

/** A lone text or JSON part is the state itself; several are a list. */
const state = (items: ReadonlyArray<unknown>) => (items.length === 1 ? items[0] : items)

const plain = (part: DecisionPart) => {
  if (part.type === "text") return part.text
  if (part.type === "json") return part.value
  return undefined
}

const stateItem = (
  part: DecisionPart,
  unsupported: (asset: Media.Asset, accepted: string) => AIError,
): Effect.Effect<unknown, AIError> => {
  if (part.type !== "media") return Effect.succeed(plain(part))
  const asset = part.media
  if (asset.kind !== "image" && asset.kind !== "audio" && asset.kind !== "video")
    return Effect.fail(unsupported(asset, "images, audio and video"))
  return ProviderShared.requireInlineMedia(NAME, asset).pipe(
    Effect.map((inline) => {
      if (asset.kind === "image") return { type: "image_url", image_url: { url: inline.dataUrl } }
      if (asset.kind === "video") return { type: "video_url", video_url: { url: inline.dataUrl } }
      return { type: "input_audio", input_audio: { data: inline.base64, format: inline.mime.slice("audio/".length) } }
    }),
  )
}

/** Map System One's answers, keyed by question name, back to the request's question order. */
export const toResponse = (
  data: Response,
  request: DecisionRequestFor,
  providerMetadataKey: string,
  invalid: (message: string) => AIError,
) => {
  const names = request.questions.map((question) => question.name)
  if (Object.keys(data.answers).length !== names.length || !names.every((name) => Object.hasOwn(data.answers, name)))
    return Effect.fail(invalid("System One answers do not match the requested questions"))
  return Effect.succeed(
    new DecisionResponse({
      answers: request.questions.map((question) => toAnswer(question, data.answers[question.name])),
      usage:
        data.usage === undefined
          ? undefined
          : new Usage({
              inputTokens: data.usage.input_tokens,
              outputTokens: data.usage.output_tokens,
              totalTokens: ProviderShared.totalTokens(data.usage.input_tokens, data.usage.output_tokens, undefined),
              providerMetadata: { [providerMetadataKey]: data.usage },
            }),
      providerMetadata: {
        [providerMetadataKey]: {
          model: data.model,
          ...(data.id === undefined ? {} : { responseId: data.id }),
          ...(data.provider === undefined ? {} : { provider: data.provider }),
          ...data.provider_metadata?.[providerMetadataKey],
        },
      },
    }),
  )
}

const toAnswer = (question: DecisionQuestion, answer: typeof Answer.Type): DecisionAnswer => {
  if (answer.type === "noul") return { name: question.name, type: "predicate", probability: answer.noul }
  if (answer.type === "choice") {
    const choices = question.type === "choice" ? question.choices : []
    const value = (key: string) => choices.find((choice) => String(choice.value) === key)?.value ?? key
    const rank = (key: string) => {
      const index = choices.findIndex((choice) => String(choice.value) === key)
      return index === -1 ? choices.length : index
    }
    return {
      name: question.name,
      type: "choice",
      choice: value(answer.choice),
      probabilities: Object.entries(answer.probabilities)
        .toSorted(([a], [b]) => rank(a) - rank(b))
        .map(([key, probability]) => ({ value: value(key), probability })),
      confidence: answer.confidence,
    }
  }
  const levels = question.type === "score" ? question.levels : []
  return {
    name: question.name,
    type: "score",
    score: answer.score,
    probabilities: Object.entries(answer.probabilities)
      .map(([key, probability]) => ({ value: Number(key), label: levels[Number(key)]?.label ?? key, probability }))
      .toSorted((a, b) => a.value - b.value),
    confidence: answer.confidence,
  }
}

const decodeDocument = MediaProtocol.identity({ id: ID, name: NAME, provider: "typesafe-ai" }).decodeJson(Response)

export const protocol = DecisionRoute.protocol({
  id: ID,
  name: NAME,
  inlineMedia: true,
  body: {
    from: (request) => encodeBody(request, "assets").pipe(Effect.map((body) => ({ ...body, model: request.model.id }))),
  },
  response: {
    decode: (response, context) =>
      decodeDocument(response).pipe(
        Effect.flatMap((output) =>
          toResponse(output.value, context.request, context.providerMetadataKey, output.invalid),
        ),
      ),
  },
})

/** TypeSafe's API, the reference System One host; other hosts change the endpoint and auth with `route.with(...)`. */
export const route = DecisionRoute.make({
  id: ID,
  provider: "typesafe-ai",
  protocol,
  endpoint: Endpoint.path("/systemone", { baseURL: DEFAULT_BASE_URL }),
})

export const SystemOne = { Response, encodeBody, toResponse, protocol, route } as const
