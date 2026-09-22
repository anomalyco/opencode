import { Effect, Schema } from "effect"
import { Headers, HttpClientRequest } from "effect/unstable/http"
import {
  ChoiceQuestion,
  EvaluationInput,
  EvaluationModel,
  EvaluationResponse,
  EvaluationRounding,
  ScoreQuestion,
  type EvaluationAnswer,
  type EvaluationOptions,
} from "./evaluation.js"
import { Auth, type Definition as AuthDefinition } from "../route/auth.js"
import {
  AIError,
  HttpContext,
  HttpOptions,
  InvalidProviderOutputError,
  InvalidRequestError,
  ModelID,
  Usage,
  mergeJsonRecords,
} from "../schema/index.js"

const Noul = Schema.Struct({
  type: Schema.Literal("noul"),
  instructions: EvaluationInput,
  criteria: Schema.optional(
    Schema.Struct({
      true: Schema.optional(Schema.NullOr(EvaluationInput)),
      false: Schema.optional(Schema.NullOr(EvaluationInput)),
    }),
  ),
})
const Question = Schema.Union([
  ChoiceQuestion.pipe(
    Schema.refine((x): x is typeof x => Object.keys(x.criteria).length <= 255, {
      message: "System One Choice questions support at most 255 options",
    }),
  ),
  ScoreQuestion.pipe(
    Schema.refine((x): x is typeof x => x.criteria.length <= 10, {
      message: "System One Score questions support at most 10 levels",
    }),
  ),
  Noul,
])
const Request = Schema.StructWithRest(
  Schema.Struct({
    model: Schema.String,
    state: EvaluationInput,
    questions: Schema.Record(Schema.String, Question),
  }),
  [Schema.Record(Schema.String, Schema.Any)],
)

const Probability = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const NoulAnswer = Schema.Struct({ type: Schema.Literal("noul"), noul: Probability })
const Choice = Schema.Struct({
  type: Schema.Literal("choice"),
  choice: Schema.String,
  probabilities: Schema.Record(Schema.String, Probability),
  confidence: Schema.optional(Probability),
})
const Score = Schema.Struct({
  type: Schema.Literal("score"),
  score: Schema.Number,
  probabilities: Schema.Record(Schema.String, Probability),
  legend: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
  confidence: Schema.optional(Probability),
})
const Answer = Schema.Union([NoulAnswer, Choice, Score]).pipe(Schema.toTaggedUnion("type"))
const NativeUsage = Schema.StructWithRest(
  Schema.Struct({
    input_tokens: Schema.optional(Schema.Number),
    output_tokens: Schema.optional(Schema.Number),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
const Response = Schema.Struct({
  model: Schema.String,
  answers: Schema.Record(Schema.String, Answer),
  usage: Schema.optional(NativeUsage),
  id: Schema.optional(Schema.String),
  provider: Schema.optional(Schema.String),
  provider_metadata: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
})

export interface ModelInput {
  readonly id: string | ModelID
  readonly provider: string
  readonly providerMetadataKey: string
  readonly auth: AuthDefinition
  readonly baseURL: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions
}

export const model = <Options extends EvaluationOptions = EvaluationOptions>(cfg: ModelInput) =>
  EvaluationModel.make<Options>({
    id: cfg.id,
    provider: cfg.provider,
    http: cfg.http,
    route: {
      id: "system-one",
      evaluate: (req, send) =>
        Effect.gen(function* () {
          const url = new URL(`${cfg.baseURL.replace(/\/$/, "")}/systemone`)
          Object.entries(req.http?.query ?? {}).forEach(([key, value]) => url.searchParams.set(key, value))
          const body = yield* Schema.encodeUnknownEffect(Schema.fromJsonString(Request))({
            ...mergeJsonRecords(req.options, req.http?.body),
            model: req.model.id,
            state: req.state,
            questions: Object.fromEntries(
              Object.entries(req.questions).map(([id, x]) => [id, x.type === "boolean" ? { ...x, type: "noul" } : x]),
            ),
          }).pipe(
            Effect.mapError(
              (cause) => new AIError({ reason: new InvalidRequestError({ message: cause.message, cause }) }),
            ),
          )
          const headers = yield* Auth.toEffect(cfg.auth)({
            request: req,
            method: "POST",
            url: url.toString(),
            body,
            headers: Headers.fromInput({ ...cfg.headers, ...req.http?.headers }),
          })
          const res = yield* send(
            HttpClientRequest.post(url).pipe(
              HttpClientRequest.setHeaders(headers),
              HttpClientRequest.bodyText(body, "application/json"),
            ),
          )
          const http = new HttpContext({ url: res.request.url, status: res.status, headers: res.headers })
          const fail = (message: string, cause: unknown, body?: string) =>
            new AIError({ reason: new InvalidProviderOutputError({ route: "system-one", message, body, http, cause }) })
          const text = yield* res.text.pipe(
            Effect.mapError((cause) => fail("Failed to read the System One response", cause)),
          )
          const data = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Response))(text).pipe(
            Effect.mapError((cause) => fail("System One returned an invalid response", cause, text)),
          )

          const confidence: Record<string, number> = {}
          const legend: Record<string, Record<string, Schema.Json>> = {}
          const answers = Object.fromEntries(
            Object.entries(data.answers).map(([id, answer]): [string, EvaluationAnswer] => {
              if (answer.type === "noul") return [id, { type: "boolean", probability: answer.noul }]
              if (answer.type === "choice") {
                if (answer.confidence !== undefined) confidence[id] = answer.confidence
                return [
                  id,
                  {
                    type: "choice",
                    choice: answer.choice,
                    probabilities: answer.probabilities,
                  },
                ]
              }
              if (answer.confidence !== undefined) confidence[id] = answer.confidence
              if (answer.legend !== undefined) legend[id] = answer.legend
              return [id, { type: "score", score: answer.score, probabilities: answer.probabilities }]
            }),
          )
          const meta = {
            ...(data.id === undefined ? {} : { responseId: data.id }),
            ...(data.provider === undefined ? {} : { provider: data.provider }),
            ...data.provider_metadata?.[cfg.providerMetadataKey],
            ...(Object.keys(confidence).length === 0 ? {} : { confidence }),
            ...(Object.keys(legend).length === 0 ? {} : { legend }),
          }
          return new EvaluationResponse({
            model: ModelID.make(data.model),
            answers,
            usage: data.usage
              ? new Usage({
                  inputTokens: data.usage.input_tokens,
                  outputTokens: data.usage.output_tokens,
                  totalTokens:
                    data.usage.input_tokens === undefined && data.usage.output_tokens === undefined
                      ? undefined
                      : (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
                  providerMetadata: { [cfg.providerMetadataKey]: data.usage },
                })
              : undefined,
            rounding: new EvaluationRounding({ probabilityDecimals: 2, scoreDecimals: 2 }),
            providerMetadata: Object.keys(meta).length === 0 ? undefined : { [cfg.providerMetadataKey]: meta },
          })
        }),
    },
  })

export const SystemOne = { model } as const
