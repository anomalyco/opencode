import { Effect, Schema } from "effect"
import { DecisionResponse, DecisionUsage, type DecisionPart, type DecisionRequest } from "../decision.js"
import type { Media } from "../media.js"
import { DecisionRoute } from "../route/decision.js"
import { Endpoint } from "../route/endpoint.js"
import { MediaProtocol } from "../route/media-protocol.js"
import {
  AIError,
  ProviderID,
  UnsupportedOperationError,
  mergeJsonRecords,
  type ProviderOptions,
} from "../schema/index.js"
import { encodeJson } from "../utils/json.js"
import { JsonObject, knownString, ProviderShared } from "./shared.js"
import { SystemOne } from "./system-one.js"
import { MediaInput } from "./utils/media-input.js"

const ID = "google-decisions"
const NAME = "Google Decisions"
export const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

const Options = Schema.Struct({
  /** Token budget for every image and video input; `ultra_high` applies to images only. */
  mediaResolution: Schema.optional(knownString<"low" | "medium" | "high" | "ultra_high">()),
})
/** Known fields map to their wire names; anything else is sent as given. */
export type OptionsInput = ProviderOptions & typeof Options.Encoded

const Usage = Schema.StructWithRest(
  Schema.Struct({
    total_input_tokens: Schema.optional(Schema.Number),
    total_output_tokens: Schema.optional(Schema.Number),
    total_tokens: Schema.optional(Schema.Number),
  }),
  [JsonObject],
)
const Response = Schema.Struct({
  answers: Schema.Record(Schema.String, SystemOne.Answer),
  usage: Schema.optional(Usage),
})

const decodeOptions = ProviderShared.validateWith(Schema.decodeUnknownEffect(Options))

const fromRequest = Effect.fn("GoogleDecisions.fromRequest")(function* (request: DecisionRequest) {
  const options = yield* decodeOptions(request.providerOptions ?? {})
  const { mediaResolution: _, ...native } = request.providerOptions ?? {}
  return {
    ...mergeJsonRecords(native, request.http?.body),
    model: request.model.id,
    input: separateText(
      yield* Effect.forEach(request.input, (part) => inputPart(request, part, options.mediaResolution)),
    ),
    questions: {
      ...(yield* SystemOne.encodeQuestions(request.questions)),
      // Google names System One's predicate criteria `true_description` and `false_description`.
      ...Object.fromEntries(
        request.questions.flatMap((question) =>
          question.type === "predicate" && question.criteria !== undefined
            ? [
                [
                  question.name,
                  {
                    type: "noul",
                    instructions: question.instructions,
                    criteria: {
                      ...(question.criteria.true === undefined ? {} : { true_description: question.criteria.true }),
                      ...(question.criteria.false === undefined ? {} : { false_description: question.criteria.false }),
                    },
                  },
                ],
              ]
            : [],
        ),
      ),
    },
  }
})

const inputPart = (
  request: DecisionRequest,
  part: DecisionPart,
  resolution: string | undefined,
): Effect.Effect<Record<string, unknown>, AIError> => {
  if (part.type === "text") return Effect.succeed({ type: "text", text: part.text })
  // Google reads every text block as text; JSON is serialized so its keys are never parsed as content blocks.
  if (part.type === "json") return Effect.succeed({ type: "text", text: encodeJson(part.value) })
  return mediaPart(request, part.media, resolution)
}

// Google joins adjacent text blocks with no separator, so each one after another starts on a new line.
const separateText = (blocks: ReadonlyArray<Record<string, unknown>>) =>
  blocks.map((block, index) =>
    block.type === "text" && blocks[index - 1]?.type === "text" ? { ...block, text: `\n${block.text}` } : block,
  )

const mediaPart = (request: DecisionRequest, asset: Media.Asset, resolution: string | undefined) => {
  const type =
    asset.kind === "image" || asset.kind === "audio" || asset.kind === "video"
      ? asset.kind
      : asset.mediaType.toLowerCase() === "application/pdf"
        ? "document"
        : undefined
  if (type === undefined)
    return Effect.fail(
      new AIError({
        reason: new UnsupportedOperationError({
          operation: "decision.media",
          provider: request.model.provider,
          route: request.model.route.id,
          message: `${NAME} takes images, audio, video and PDFs; got ${asset.mediaType}`,
        }),
      }),
    )
  const block = {
    type,
    mime_type: asset.mediaType.toLowerCase(),
    // `ultra_high` is image-only, so video keeps Google's default for it.
    ...(resolution !== undefined && (type === "image" || (type === "video" && resolution !== "ultra_high"))
      ? { resolution }
      : {}),
  }
  const inline = asset.inline()
  if (inline) return Effect.succeed({ ...block, data: inline.base64 })
  // Google fetches URLs itself, so one that needs our download credentials can't be forwarded.
  if (asset.source.type === "url" && /^https:\/\//i.test(asset.source.url) && asset.headers === undefined)
    return Effect.succeed({ ...block, uri: asset.source.url })
  const file = MediaInput.refID(asset, ProviderID.make("google"))
  if (file !== undefined) return Effect.succeed({ ...block, uri: file })
  return Effect.fail(
    ProviderShared.invalidRequest(
      `${NAME} accepts inline media, public HTTPS URLs and Google Files API URIs; materialize ${asset.source.type} media first`,
    ),
  )
}

const decodeDocument = MediaProtocol.identity({ id: ID, name: NAME, provider: "google" }).decodeJson(Response)

export const protocol = DecisionRoute.protocol({
  id: ID,
  name: NAME,
  body: { from: fromRequest },
  response: {
    decode: Effect.fn("GoogleDecisions.decodeResponse")(function* (response, context) {
      const output = yield* decodeDocument(response)
      const data = output.value
      const answers = data.answers
      const names = context.request.questions.map((question) => question.name)
      if (Object.keys(answers).length !== names.length || !names.every((name) => Object.hasOwn(answers, name)))
        return yield* output.invalid(`${NAME} answers do not match the requested questions`)
      return new DecisionResponse({
        answers: context.request.questions.map((question) => SystemOne.toAnswer(question, answers[question.name])),
        usage:
          data.usage === undefined
            ? undefined
            : new DecisionUsage({
                inputTokens: data.usage.total_input_tokens,
                outputTokens: data.usage.total_output_tokens,
                totalTokens: ProviderShared.totalTokens(
                  data.usage.total_input_tokens,
                  data.usage.total_output_tokens,
                  data.usage.total_tokens,
                ),
              }),
        providerMetadata:
          data.usage === undefined ? undefined : { [context.providerMetadataKey]: { usage: data.usage } },
      })
    }),
  },
})

export const route = DecisionRoute.make({
  id: ID,
  provider: "google",
  protocol,
  endpoint: Endpoint.path("/decisions", { baseURL: DEFAULT_BASE_URL }),
})

export * as GoogleDecisions from "./google-decisions.js"
