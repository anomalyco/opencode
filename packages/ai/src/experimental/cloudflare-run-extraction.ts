import { Effect, Schema } from "effect"
import { ExtractionAnswers, ExtractionModel, ExtractionResponse, type ExtractionRequestFor } from "./extraction.js"
import { JsonObject, ProviderShared } from "../protocols/shared.js"
import { Endpoint } from "../route/endpoint.js"
import { MediaProtocol } from "../route/media-protocol.js"
import { MediaRoute } from "../route/media.js"
import { Usage, mergeJsonRecords } from "../schema/index.js"

const route = MediaProtocol.identity({
  id: "cloudflare-run-extraction",
  name: "Cloudflare Run",
  provider: "cloudflare-workers-ai",
})

const decodeEnvelope = route.decodeJson(
  Schema.Struct({
    result: Schema.Struct({
      model: Schema.String,
      answers: Schema.Record(Schema.String, JsonObject),
      truncated: Schema.optional(Schema.Boolean),
      state_text: Schema.optional(Schema.String),
      usage: Schema.optional(
        Schema.StructWithRest(
          Schema.Struct({ input_tokens: Schema.optional(Schema.Number), output_tokens: Schema.optional(Schema.Number) }),
          [JsonObject],
        ),
      ),
    }),
  }),
)

/** Posts Clairic's `{ model, state, fields }` body to Cloudflare's `/ai/run/{model}`. */
export const protocol = MediaProtocol.inline<ExtractionRequestFor, ExtractionResponse>(route, {
  body: {
    from: (request) =>
      Effect.succeed(
        MediaProtocol.json({
          ...mergeJsonRecords(request.providerOptions, request.http?.body),
          model: request.model.id,
          state: request.input,
          fields: Object.fromEntries(
            Object.entries(request.fields).map(([name, field]) => {
              const { nullThreshold, ...rest } = field
              return [name, nullThreshold === undefined ? rest : { ...rest, null_threshold: nullThreshold }]
            }),
          ),
          ...(request.referenceDate === undefined ? {} : { reference_date: request.referenceDate }),
        }),
      ),
  },
  response: {
    decode: Effect.fn("CloudflareRunExtraction.decodeResponse")(function* (response, context) {
      const output = yield* decodeEnvelope(response)
      const result = output.value.result
      // Each answer decodes as the field it answers; extra answers are dropped.
      const answers = yield* Effect.forEach(Object.entries(context.request.fields), ([name, field]) => {
        if (!Object.hasOwn(result.answers, name))
          return Effect.fail(output.invalid(`${route.name} returned no answer for ${name}`))
        if (!Object.hasOwn(ExtractionAnswers, field.type)) return Effect.succeed([name, result.answers[name]] as const)
        return Schema.decodeUnknownEffect(ExtractionAnswers[field.type as keyof typeof ExtractionAnswers])(
          result.answers[name],
        ).pipe(
          Effect.map((answer) => [name, answer] as const),
          Effect.mapError((cause) => output.invalid(`${route.name} returned an invalid answer for ${name}`, cause)),
        )
      })
      return new ExtractionResponse({
        answers: Object.fromEntries(answers),
        usage:
          result.usage === undefined
            ? undefined
            : new Usage({
                inputTokens: result.usage.input_tokens,
                outputTokens: result.usage.output_tokens,
                totalTokens: ProviderShared.totalTokens(result.usage.input_tokens, result.usage.output_tokens, undefined),
                providerMetadata: { [route.provider]: result.usage },
              }),
        providerMetadata: {
          [route.provider]: {
            model: result.model,
            ...(result.truncated === undefined ? {} : { truncated: result.truncated }),
            ...(result.state_text === undefined ? {} : { stateText: result.state_text }),
          },
        },
      })
    }),
  },
})

/** `baseURL` is the Run API base, `.../client/v4/accounts/{account}/ai/run`. */
export const model = (input: MediaRoute.ModelInput) =>
  new ExtractionModel({
    id: input.id,
    provider: route.provider,
    http: input.http,
    route: MediaRoute.inline({
      protocol,
      endpoint: Endpoint.path<MediaProtocol.Body, ExtractionRequestFor>(({ request }) => `/${request.model.id}`, {
        baseURL: input.baseURL,
      }),
      auth: input.auth,
      headers: input.headers,
    }),
  })

export const CloudflareRunExtraction = { protocol, model } as const
