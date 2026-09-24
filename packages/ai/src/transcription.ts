import { Effect, Schema, Stream } from "effect"
import { Generation, ProgressEvent, QueuedEvent, type AwaitOptions } from "./generation.js"
import { Media } from "./media.js"
import { MediaModel, composeAnyRoute, tryRequest } from "./media-model.js"
import { MediaRoute } from "./route/media.js"
import type { MediaProtocol } from "./route/media-protocol.js"
import { AIError, HttpOptions, MediaUsage, ProviderMetadata } from "./schema/index.js"
import { TranscriptionClient, Service } from "./transcription-client.js"

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type TranscriptionOptions = Record<string, unknown>

export type TranscriptionRoute<Options extends TranscriptionOptions = TranscriptionOptions> = MediaRoute.AnyRoute<
  TranscriptionRequestFor<Options>,
  TranscriptionEvent,
  TranscriptionResponse
>

export class TranscriptionModel<Options extends TranscriptionOptions = TranscriptionOptions> extends MediaModel<
  TranscriptionRoute<Options>,
  Options
> {
  declare protected readonly _TranscriptionModel: void

  static make<Options extends TranscriptionOptions = TranscriptionOptions>(
    input: MediaModel.Input<TranscriptionRoute<Options>>,
  ) {
    return new TranscriptionModel<Options>(input)
  }

  /** The number of type arguments selects the kind: `<Options>`, `<Options, Frame, State>`, or `<Options, Token>`. */
  static fromRoute<Options extends TranscriptionOptions>(
    route: TranscriptionModel.InlineRouteInput<Options>,
    input: MediaRoute.ModelInput,
  ): TranscriptionModel<Options>
  static fromRoute<Options extends TranscriptionOptions, Frame, State>(
    route: TranscriptionModel.StreamRouteInput<Options, Frame, State>,
    input: MediaRoute.ModelInput,
  ): TranscriptionModel<Options>
  static fromRoute<Options extends TranscriptionOptions, Token>(
    route: TranscriptionModel.QueuedRouteInput<Options, Token>,
    input: MediaRoute.ModelInput,
  ): TranscriptionModel<Options>
  static fromRoute<Options extends TranscriptionOptions, Frame, State, Token>(
    route: TranscriptionModel.RouteInput<Options, Frame, State, Token>,
    input: MediaRoute.ModelInput,
  ) {
    return new TranscriptionModel<Options>({
      id: input.id,
      provider: route.protocol.provider,
      http: input.http,
      route: composeAnyRoute(route, input, collectResponse),
    })
  }
}

export namespace TranscriptionModel {
  export type InlineRouteInput<Options extends TranscriptionOptions = TranscriptionOptions> = MediaModel.RouteInput<
    TranscriptionRequestFor<Options>,
    MediaProtocol.Inline<TranscriptionRequestFor<Options>, TranscriptionResponse>
  >

  export type StreamRouteInput<
    Options extends TranscriptionOptions = TranscriptionOptions,
    Frame = unknown,
    State = unknown,
  > = MediaModel.RouteInput<
    MediaProtocol.Addressed<TranscriptionRequestFor<Options>>,
    MediaProtocol.Streamed<TranscriptionRequestFor<Options>, TranscriptionEvent, Frame, State>
  >

  export type QueuedRouteInput<
    Options extends TranscriptionOptions = TranscriptionOptions,
    Token = unknown,
  > = MediaModel.RouteInput<
    TranscriptionRequestFor<Options>,
    MediaProtocol.Queued<TranscriptionRequestFor<Options>, TranscriptionResponse, Token>
  >

  export type RouteInput<
    Options extends TranscriptionOptions = TranscriptionOptions,
    Frame = unknown,
    State = unknown,
    Token = unknown,
  > = MediaModel.AnyRouteInput<
    TranscriptionRequestFor<Options>,
    TranscriptionEvent,
    TranscriptionResponse,
    Frame,
    State,
    Token
  >
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

export class TranscriptionRequest extends Schema.Class<TranscriptionRequest>("Transcription.Request")({
  model: TranscriptionModelSchema,
  audio: Media.AssetSchema,
  language: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  /** Routes that cannot produce the requested granularity fail typed; routes may return more than asked. */
  timestamps: Schema.optional(TranscriptionTimestamps),
  diarize: Schema.optional(Schema.Boolean),
  speakers: Schema.optional(Schema.Int),
  providerOptions: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  http: Schema.optional(HttpOptions),
}) {
  declare protected readonly _TranscriptionRequest: void
}

export type TranscriptionRequestFor<Options extends TranscriptionOptions = TranscriptionOptions> = Omit<
  TranscriptionRequest,
  "model" | "providerOptions"
> & {
  readonly model: TranscriptionModel<Options>
  readonly providerOptions?: Options
}

export type TranscriptionModelOptions<Model> = Model extends TranscriptionModel<infer Options> ? Options : never

export type TranscriptionRequestInput<Model extends TranscriptionModel = TranscriptionModel> = Omit<
  ConstructorParameters<typeof TranscriptionRequest>[0],
  "model" | "providerOptions" | "http"
> & {
  readonly model: Model
  readonly providerOptions?: NoInfer<TranscriptionModelOptions<Model>>
  readonly http?: HttpOptions.Input
}

// ---------------------------------------------------------------------------
// Response and events
// ---------------------------------------------------------------------------

/** Speaker labels are provider-native (`A`, `0`, `spk:0`, or a known speaker name). */
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
  notices: Schema.optional(Schema.Array(Media.Notice)),
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

export const responseEvents = (response: TranscriptionResponse): ReadonlyArray<TranscriptionEvent> => [
  TranscriptionFinishEvent.make({ ...response }),
]

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

export function request<const Model extends TranscriptionModel>(
  input: TranscriptionRequestInput<Model>,
): TranscriptionRequestFor<TranscriptionModelOptions<Model>>
export function request(input: TranscriptionRequest): TranscriptionRequest
export function request(input: TranscriptionRequest | TranscriptionRequestInput) {
  if (input instanceof TranscriptionRequest) return input
  return new TranscriptionRequest({
    ...input,
    http: HttpOptions.make(input.http),
  })
}

const requestEffect = (input: TranscriptionRequest | TranscriptionRequestInput) => tryRequest(() => request(input))

export function generate<const Model extends TranscriptionModel>(
  input: TranscriptionRequestInput<Model>,
  options?: AwaitOptions,
): Effect.Effect<TranscriptionResponse, AIError, Service>
export function generate(
  input: TranscriptionRequest,
  options?: AwaitOptions,
): Effect.Effect<TranscriptionResponse, AIError, Service>
export function generate(input: TranscriptionRequest | TranscriptionRequestInput, options?: AwaitOptions) {
  return requestEffect(input).pipe(Effect.flatMap((request) => TranscriptionClient.generate(request, options)))
}

export function stream<const Model extends TranscriptionModel>(
  input: TranscriptionRequestInput<Model>,
  options?: AwaitOptions,
): Stream.Stream<TranscriptionEvent, AIError, Service>
export function stream(
  input: TranscriptionRequest,
  options?: AwaitOptions,
): Stream.Stream<TranscriptionEvent, AIError, Service>
export function stream(input: TranscriptionRequest | TranscriptionRequestInput, options?: AwaitOptions) {
  return Stream.unwrap(requestEffect(input).pipe(Effect.map((request) => TranscriptionClient.stream(request, options))))
}

/** Inline and streaming routes fail with `UnsupportedOperation`. */
export function start<const Model extends TranscriptionModel>(
  input: TranscriptionRequestInput<Model>,
): Effect.Effect<Generation<TranscriptionResponse>, AIError, Service>
export function start(input: TranscriptionRequest): Effect.Effect<Generation<TranscriptionResponse>, AIError, Service>
export function start(input: TranscriptionRequest | TranscriptionRequestInput) {
  return requestEffect(input).pipe(Effect.flatMap((request) => TranscriptionClient.start(request)))
}

export const resume = <Options extends TranscriptionOptions>(
  model: TranscriptionModel<Options>,
  token: unknown,
): Effect.Effect<Generation<TranscriptionResponse>, AIError, Service> => TranscriptionClient.resume(model, token)

export const Transcription = {
  request,
  generate,
  stream,
  start,
  resume,
} as const
