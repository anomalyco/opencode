import { Effect, Schema, Stream } from "effect"
import { Generation, ProgressEvent, QueuedEvent, type AwaitOptions } from "./generation.js"
import { Media } from "./media.js"
import { type MediaModel, composeRoute, mediaOptions, tryRequest } from "./media-model.js"
import { MediaRoute } from "./route/media.js"
import {
  AIError,
  MediaUsage,
  ProviderMetadata,
  ProviderOptions,
  type BaseRequest,
  mediaApi,
  implementation,
  Model,
  modelSchema,
  type ModelProviderOptions,
} from "./schema/index.js"
import { TranscriptionClient, Service } from "./transcription-client.js"

// ---------------------------------------------------------------------------
// SelectedModel
// ---------------------------------------------------------------------------

export type TranscriptionOptions = MediaModel.Options

export type TranscriptionRoute = MediaRoute.AnyRoute<TranscriptionRequest, TranscriptionEvent, TranscriptionResponse>

/** The number of type arguments selects the kind: `<Options>`, `<Options, Frame, State>`, or `<Options, Token>`. */
export function transcriptionModel<Options extends TranscriptionOptions>(
  route: MediaModel.InlineRouteInput<TranscriptionRequest<Model<"transcription", Options>>, TranscriptionResponse>,
  input: MediaRoute.ModelInput,
): Model<"transcription", Options>
export function transcriptionModel<Options extends TranscriptionOptions, Frame, State>(
  route: MediaModel.StreamRouteInput<
    TranscriptionRequest<Model<"transcription", Options>>,
    TranscriptionEvent,
    Frame,
    State
  >,
  input: MediaRoute.ModelInput,
): Model<"transcription", Options>
export function transcriptionModel<Options extends TranscriptionOptions, Token>(
  route: MediaModel.QueuedRouteInput<
    TranscriptionRequest<Model<"transcription", Options>>,
    TranscriptionResponse,
    Token
  >,
  input: MediaRoute.ModelInput,
): Model<"transcription", Options>
export function transcriptionModel<Options extends TranscriptionOptions, Frame, State, Token>(
  route: MediaModel.AnyRouteInput<
    TranscriptionRequest<Model<"transcription", Options>>,
    TranscriptionEvent,
    TranscriptionResponse,
    Frame,
    State,
    Token
  >,
  input: MediaRoute.ModelInput,
) {
  return Model.make<"transcription", Options>({
    type: "transcription",
    id: input.id,
    provider: route.protocol.provider,
    options: mediaOptions(input),
    api: mediaApi(route.protocol.id),
    [implementation]: composeRoute(route, input, collectResponse) as TranscriptionRoute,
  })
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const TranscriptionTimestamps = Schema.Literals(["none", "segment", "word"])
export type TranscriptionTimestamps = Schema.Schema.Type<typeof TranscriptionTimestamps>

const TranscriptionRequestSchema = Schema.Struct({
  model: modelSchema("transcription"),
  audio: Media.AssetSchema,
  language: Schema.optional(Schema.String),
  prompt: Schema.optional(Schema.String),
  /** Routes that cannot produce the requested granularity fail typed; routes may return more than asked. */
  timestamps: Schema.optional(TranscriptionTimestamps),
  diarize: Schema.optional(Schema.Boolean),
  speakers: Schema.optional(Schema.Int),
  providerOptions: Schema.optional(ProviderOptions),
})

/** A normalized transcription request, the plain object `Transcription.request(...)` returns. */
export type TranscriptionRequest<SelectedModel extends Model<"transcription"> = Model<"transcription">> = Omit<
  typeof TranscriptionRequestSchema.Type,
  "model" | "providerOptions"
> &
  BaseRequest<SelectedModel, ModelProviderOptions<SelectedModel>>

/** Input accepted by `Transcription.request` and the calls; a `TranscriptionRequest` is also a valid input. */
export type TranscriptionRequestInput<SelectedModel extends Model<"transcription"> = Model<"transcription">> = Omit<
  TranscriptionRequest<SelectedModel>,
  "providerOptions"
> & {
  readonly providerOptions?: NoInfer<ModelProviderOptions<SelectedModel>>
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
export const request = <const SelectedModel extends Model<"transcription">>(
  input: TranscriptionRequestInput<SelectedModel>,
): TranscriptionRequest<SelectedModel> => ({
  ...input,
})

const validate = Schema.decodeUnknownSync(TranscriptionRequestSchema)

const requestEffect = (input: TranscriptionRequestInput) =>
  tryRequest(() => {
    const normalized = request(input)
    validate(normalized)
    return normalized
  })

export function generate<const SelectedModel extends Model<"transcription">>(
  input: TranscriptionRequestInput<SelectedModel>,
  options?: AwaitOptions,
): Effect.Effect<TranscriptionResponse, AIError, Service>
export function generate(input: TranscriptionRequestInput, options?: AwaitOptions) {
  return requestEffect(input).pipe(Effect.flatMap((request) => TranscriptionClient.generate(request, options)))
}

export function stream<const SelectedModel extends Model<"transcription">>(
  input: TranscriptionRequestInput<SelectedModel>,
  options?: AwaitOptions,
): Stream.Stream<TranscriptionEvent, AIError, Service>
export function stream(input: TranscriptionRequestInput, options?: AwaitOptions) {
  return Stream.unwrap(requestEffect(input).pipe(Effect.map((request) => TranscriptionClient.stream(request, options))))
}

/** Inline and streaming routes fail with `UnsupportedOperation`. */
export function start<const SelectedModel extends Model<"transcription">>(
  input: TranscriptionRequestInput<SelectedModel>,
): Effect.Effect<Generation<TranscriptionResponse>, AIError, Service>
export function start(input: TranscriptionRequestInput) {
  return requestEffect(input).pipe(Effect.flatMap((request) => TranscriptionClient.start(request)))
}

export const resume = (
  model: Model<"transcription">,
  token: unknown,
): Effect.Effect<Generation<TranscriptionResponse>, AIError, Service> => TranscriptionClient.resume(model, token)

export const Transcription = {
  request,
  generate,
  stream,
  start,
  resume,
} as const
