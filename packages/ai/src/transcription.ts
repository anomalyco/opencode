import { Effect, Schema, Stream } from "effect"
import { Generation, ProgressEvent, QueuedEvent, type AwaitOptions } from "./generation.js"
import { Media } from "./media.js"
import { MediaModel, composeRoute, tryRequest } from "./media-model.js"
import { MediaRoute } from "./route/media.js"
import { AIError, HttpOptions, MediaUsage, ProviderMetadata, ProviderOptions } from "./schema/index.js"
import { TranscriptionClient, Service } from "./transcription-client.js"

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type TranscriptionOptions = MediaModel.Options

export type TranscriptionRoute = MediaRoute.AnyRoute<TranscriptionRequest, TranscriptionEvent, TranscriptionResponse>

export class TranscriptionModel<Options extends TranscriptionOptions = TranscriptionOptions> extends MediaModel<
  TranscriptionRoute,
  Options
> {
  declare protected readonly _TranscriptionModel: void

  /** The number of type arguments selects the kind: `<Options>`, `<Options, Frame, State>`, or `<Options, Token>`. */
  static fromRoute<Options extends TranscriptionOptions>(
    route: MediaModel.InlineRouteInput<TranscriptionRequest<TranscriptionModel<Options>>, TranscriptionResponse>,
    input: MediaRoute.ModelInput,
  ): TranscriptionModel<Options>
  static fromRoute<Options extends TranscriptionOptions, Frame, State>(
    route: MediaModel.StreamRouteInput<
      TranscriptionRequest<TranscriptionModel<Options>>,
      TranscriptionEvent,
      Frame,
      State
    >,
    input: MediaRoute.ModelInput,
  ): TranscriptionModel<Options>
  static fromRoute<Options extends TranscriptionOptions, Token>(
    route: MediaModel.QueuedRouteInput<TranscriptionRequest<TranscriptionModel<Options>>, TranscriptionResponse, Token>,
    input: MediaRoute.ModelInput,
  ): TranscriptionModel<Options>
  static fromRoute<Options extends TranscriptionOptions, Frame, State, Token>(
    route: MediaModel.AnyRouteInput<
      TranscriptionRequest<TranscriptionModel<Options>>,
      TranscriptionEvent,
      TranscriptionResponse,
      Frame,
      State,
      Token
    >,
    input: MediaRoute.ModelInput,
  ) {
    return new TranscriptionModel<Options>({
      id: input.id,
      provider: route.protocol.provider,
      http: input.http,
      providerOptions: input.providerOptions,
      route: composeRoute(route, input, collectResponse) as TranscriptionRoute,
    })
  }
}

export const TranscriptionModelSchema = Schema.declare(
  (value): value is TranscriptionModel => value instanceof TranscriptionModel,
  { expected: "Transcription.Model" },
)

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const TranscriptionTimestamps = Schema.Literals(["none", "segment", "word"])
export type TranscriptionTimestamps = Schema.Schema.Type<typeof TranscriptionTimestamps>

const TranscriptionRequestSchema = Schema.Struct({
  model: TranscriptionModelSchema,
  audio: Media.AssetSchema,
  language: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  /** Routes that cannot produce the requested granularity fail typed; routes may return more than asked. */
  timestamps: Schema.optional(TranscriptionTimestamps),
  diarize: Schema.optional(Schema.Boolean),
  speakers: Schema.optional(Schema.Int),
  providerOptions: Schema.optional(ProviderOptions),
  http: Schema.optional(HttpOptions),
})

/** A normalized transcription request, the plain object `Transcription.request(...)` returns. */
export type TranscriptionRequest<Model extends TranscriptionModel = TranscriptionModel> = Omit<
  typeof TranscriptionRequestSchema.Type,
  "model" | "providerOptions"
> & {
  readonly model: Model
  readonly providerOptions?: TranscriptionModelOptions<Model>
}

export type TranscriptionModelOptions<Model> = Model extends TranscriptionModel<infer Options> ? Options : never

/** Input accepted by `Transcription.request` and the calls; a `TranscriptionRequest` is also a valid input. */
export type TranscriptionRequestInput<Model extends TranscriptionModel = TranscriptionModel> = Omit<
  TranscriptionRequest<Model>,
  "providerOptions" | "http"
> & {
  readonly providerOptions?: NoInfer<TranscriptionModelOptions<Model>>
  readonly http?: HttpOptions.Input
}

// ---------------------------------------------------------------------------
// Response and events
// ---------------------------------------------------------------------------

/** Speaker labels are provider-native (`A`, `0`, `spk:0`, `speaker_0`, or a known speaker name). */
export const TranscriptionSegment = Schema.Struct({
  text: Schema.String,
  startSeconds: Schema.Number,
  endSeconds: Schema.Number,
  speaker: Schema.optional(Schema.String),
}).annotate({ identifier: "Transcription.Segment" })
export type TranscriptionSegment = Schema.Schema.Type<typeof TranscriptionSegment>

export const TranscriptionWord = Schema.Struct({
  text: Schema.String,
  startSeconds: Schema.Number,
  endSeconds: Schema.Number,
  speaker: Schema.optional(Schema.String),
  confidence: Schema.optional(Schema.Number),
}).annotate({ identifier: "Transcription.Word" })
export type TranscriptionWord = Schema.Schema.Type<typeof TranscriptionWord>

const transcriptFields = {
  text: Schema.String,
  segments: Schema.optional(Schema.Array(TranscriptionSegment)),
  words: Schema.optional(Schema.Array(TranscriptionWord)),
  /** Provider-native language as detected or echoed (`en`, `english`, `en_us`), lowercased but not normalized. */
  language: Schema.optional(Schema.String),
  durationSeconds: Schema.optional(Schema.Number),
  usage: Schema.optional(MediaUsage),
  providerMetadata: Schema.optional(ProviderMetadata),
}

export class TranscriptionResponse extends Schema.Class<TranscriptionResponse>("Transcription.Response")(
  transcriptFields,
) {}

export const TranscriptionTextDeltaEvent = Schema.Struct({
  type: Schema.tag("text-delta"),
  delta: Schema.String,
}).annotate({ identifier: "Transcription.Event.TextDelta" })

export const TranscriptionSegmentEvent = Schema.Struct({
  type: Schema.tag("segment"),
  segment: TranscriptionSegment,
}).annotate({ identifier: "Transcription.Event.Segment" })

export const TranscriptionFinishEvent = Schema.Struct({
  type: Schema.tag("finish"),
  ...transcriptFields,
}).annotate({ identifier: "Transcription.Event.Finish" })

const transcriptionEventTagged = Schema.Union([
  QueuedEvent,
  ProgressEvent,
  TranscriptionTextDeltaEvent,
  TranscriptionSegmentEvent,
  TranscriptionFinishEvent,
]).pipe(Schema.toTaggedUnion("type"))
export const TranscriptionEvent = Object.assign(transcriptionEventTagged, {
  is: {
    generationQueued: transcriptionEventTagged.guards["generation-queued"],
    generationProgress: transcriptionEventTagged.guards["generation-progress"],
    textDelta: transcriptionEventTagged.guards["text-delta"],
    segment: transcriptionEventTagged.guards.segment,
    finish: transcriptionEventTagged.guards.finish,
  },
})
export type TranscriptionEvent = Schema.Schema.Type<typeof transcriptionEventTagged>

const collectResponse = (events: ReadonlyArray<TranscriptionEvent>): Effect.Effect<TranscriptionResponse> => {
  const finish = events.find(TranscriptionEvent.is.finish)
  // Every transcription protocol's `finish` emits the terminal event or fails, so a completed stream always has one.
  if (finish === undefined) return Effect.die(new Error("The transcription stream completed without a finish event"))
  const { type: _type, ...transcript } = finish
  return Effect.succeed(new TranscriptionResponse(transcript))
}

// ---------------------------------------------------------------------------
// Request-shaped call API
// ---------------------------------------------------------------------------

/** Normalize transcription request input into a plain `TranscriptionRequest`. */
export const request = <const Model extends TranscriptionModel>(
  input: TranscriptionRequestInput<Model>,
): TranscriptionRequest<Model> => ({
  ...input,
  http: HttpOptions.make(input.http),
})

const validate = Schema.decodeUnknownSync(TranscriptionRequestSchema)

const requestEffect = (input: TranscriptionRequestInput) =>
  tryRequest(() => {
    const normalized = request(input)
    validate(normalized)
    return normalized
  })

export function generate<const Model extends TranscriptionModel>(
  input: TranscriptionRequestInput<Model>,
  options?: AwaitOptions,
): Effect.Effect<TranscriptionResponse, AIError, Service>
export function generate(input: TranscriptionRequestInput, options?: AwaitOptions) {
  return requestEffect(input).pipe(Effect.flatMap((request) => TranscriptionClient.generate(request, options)))
}

export function stream<const Model extends TranscriptionModel>(
  input: TranscriptionRequestInput<Model>,
  options?: AwaitOptions,
): Stream.Stream<TranscriptionEvent, AIError, Service>
export function stream(input: TranscriptionRequestInput, options?: AwaitOptions) {
  return Stream.unwrap(requestEffect(input).pipe(Effect.map((request) => TranscriptionClient.stream(request, options))))
}

/** Inline and streaming routes fail with `UnsupportedOperation`. */
export function start<const Model extends TranscriptionModel>(
  input: TranscriptionRequestInput<Model>,
): Effect.Effect<Generation<TranscriptionResponse>, AIError, Service>
export function start(input: TranscriptionRequestInput) {
  return requestEffect(input).pipe(Effect.flatMap((request) => TranscriptionClient.start(request)))
}

export const resume = (
  model: TranscriptionModel,
  token: unknown,
): Effect.Effect<Generation<TranscriptionResponse>, AIError, Service> => TranscriptionClient.resume(model, token)

export const Transcription = {
  request,
  generate,
  stream,
  start,
  resume,
} as const
