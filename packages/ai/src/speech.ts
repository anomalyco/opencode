import { Effect, Schema, Stream } from "effect"
import { ProgressEvent, QueuedEvent } from "./generation.js"
import { Media } from "./media.js"
import { MediaModel, composeRoute, tryRequest } from "./media-model.js"
import { MediaRoute } from "./route/media.js"
import { AIError, HttpOptions, MediaUsage, ProviderMetadata, ProviderOptions, type OpenString } from "./schema/index.js"
import { SpeechClient, Service } from "./speech-client.js"

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type SpeechOptions = MediaModel.Options

export type SpeechRoute = MediaRoute.AnyRoute<SpeechRequest, SpeechEvent, SpeechResponse>

export class SpeechModel<Options extends SpeechOptions = SpeechOptions> extends MediaModel<SpeechRoute, Options> {
  declare protected readonly _SpeechModel: void

  /** The number of type arguments selects the kind: `<Options>`, `<Options, Frame, State>`, or `<Options, Token>`. */
  static fromRoute<Options extends SpeechOptions>(
    route: MediaModel.InlineRouteInput<SpeechRequest<SpeechModel<Options>>, SpeechResponse>,
    input: MediaRoute.ModelInput,
  ): SpeechModel<Options>
  static fromRoute<Options extends SpeechOptions, Frame, State>(
    route: MediaModel.StreamRouteInput<SpeechRequest<SpeechModel<Options>>, SpeechEvent, Frame, State>,
    input: MediaRoute.ModelInput,
  ): SpeechModel<Options>
  static fromRoute<Options extends SpeechOptions, Token>(
    route: MediaModel.QueuedRouteInput<SpeechRequest<SpeechModel<Options>>, SpeechResponse, Token>,
    input: MediaRoute.ModelInput,
  ): SpeechModel<Options>
  static fromRoute<Options extends SpeechOptions, Frame, State, Token>(
    route: MediaModel.AnyRouteInput<
      SpeechRequest<SpeechModel<Options>>,
      SpeechEvent,
      SpeechResponse,
      Frame,
      State,
      Token
    >,
    input: MediaRoute.ModelInput,
  ) {
    return new SpeechModel<Options>({
      id: input.id,
      provider: route.protocol.provider,
      http: input.http,
      providerOptions: input.providerOptions,
      route: composeRoute(route, input, collectResponse) as SpeechRoute,
    })
  }
}

export const SpeechModelSchema = Schema.declare((value): value is SpeechModel => value instanceof SpeechModel, {
  expected: "Speech.Model",
})

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/** Provider-native: a name on OpenAI and Gemini, a voice id on ElevenLabs and Cartesia; `{ id }` is an OpenAI custom voice. */
export const SpeechVoice = Schema.Union([Schema.String, Schema.Struct({ id: Schema.String })]).annotate({
  identifier: "Speech.Voice",
})
export type SpeechVoice = Schema.Schema.Type<typeof SpeechVoice>

export type SpeechFormat = OpenString<"mp3" | "wav" | "pcm" | "opus" | "aac" | "flac">

/** Granularity is provider-native: characters on ElevenLabs, words on Cartesia. */
export const SpeechTimestamp = Schema.Struct({
  text: Schema.String,
  startSeconds: Schema.Number,
  endSeconds: Schema.Number,
}).annotate({ identifier: "Speech.Timestamp" })
export type SpeechTimestamp = Schema.Schema.Type<typeof SpeechTimestamp>

const SpeechRequestSchema = Schema.Struct({
  model: SpeechModelSchema,
  text: Schema.String,
  voice: Schema.optional(SpeechVoice),
  format: Schema.optional(Schema.String),
  speed: Schema.optional(Schema.Number),
  language: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  timestamps: Schema.optional(Schema.Boolean),
  providerOptions: Schema.optional(ProviderOptions),
  http: Schema.optional(HttpOptions),
})

/** A normalized speech request, the plain object `Speech.request(...)` returns. */
export type SpeechRequest<Model extends SpeechModel = SpeechModel> = Omit<
  typeof SpeechRequestSchema.Type,
  "model" | "providerOptions" | "format"
> & {
  readonly model: Model
  readonly format?: SpeechFormat
  readonly providerOptions?: SpeechModelOptions<Model>
}

export type SpeechModelOptions<Model> = Model extends SpeechModel<infer Options> ? Options : never

/** Input accepted by `Speech.request` and the calls; a `SpeechRequest` is also a valid input. */
export type SpeechRequestInput<Model extends SpeechModel = SpeechModel> = Omit<
  SpeechRequest<Model>,
  "providerOptions" | "http"
> & {
  readonly providerOptions?: NoInfer<SpeechModelOptions<Model>>
  readonly http?: HttpOptions.Input
}

// ---------------------------------------------------------------------------
// Response and events
// ---------------------------------------------------------------------------

export class SpeechResponse extends Schema.Class<SpeechResponse>("Speech.Response")({
  /** The complete audio. Headerless PCM carries `info.encoding`, `info.sampleRate`, and `info.channels`. */
  audio: Media.AssetSchema,
  timestamps: Schema.optional(Schema.Array(SpeechTimestamp)),
  usage: Schema.optional(MediaUsage),
  providerMetadata: Schema.optional(ProviderMetadata),
}) {}

export const SpeechAudioDeltaEvent = Schema.Struct({
  type: Schema.tag("audio-delta"),
  chunk: Schema.Uint8Array,
}).annotate({ identifier: "Speech.Event.AudioDelta" })

export const SpeechTimestampsEvent = Schema.Struct({
  type: Schema.tag("timestamps"),
  items: Schema.Array(SpeechTimestamp),
}).annotate({ identifier: "Speech.Event.Timestamps" })

/** `audio` is every `audio-delta` chunk concatenated, so the route holds the whole clip in memory until `finish`. */
export const SpeechFinishEvent = Schema.Struct({
  type: Schema.tag("finish"),
  audio: Media.AssetSchema,
  usage: Schema.optional(MediaUsage),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "Speech.Event.Finish" })

const speechEventTagged = Schema.Union([
  QueuedEvent,
  ProgressEvent,
  SpeechAudioDeltaEvent,
  SpeechTimestampsEvent,
  SpeechFinishEvent,
]).pipe(Schema.toTaggedUnion("type"))
export const SpeechEvent = Object.assign(speechEventTagged, {
  is: {
    generationQueued: speechEventTagged.guards["generation-queued"],
    generationProgress: speechEventTagged.guards["generation-progress"],
    audioDelta: speechEventTagged.guards["audio-delta"],
    timestamps: speechEventTagged.guards.timestamps,
    finish: speechEventTagged.guards.finish,
  },
})
export type SpeechEvent = Schema.Schema.Type<typeof speechEventTagged>

const collectResponse = (events: ReadonlyArray<SpeechEvent>): Effect.Effect<SpeechResponse> => {
  const finish = events.find(SpeechEvent.is.finish)
  // Every speech protocol's `finish` emits the terminal event or fails, so a completed stream always has one.
  if (finish === undefined) return Effect.die(new Error("The speech stream completed without a finish event"))
  const timestamps = events.filter(SpeechEvent.is.timestamps).flatMap((event) => event.items)
  return Effect.succeed(
    new SpeechResponse({
      audio: finish.audio,
      timestamps: timestamps.length === 0 ? undefined : timestamps,
      usage: finish.usage,
      providerMetadata: finish.providerMetadata,
    }),
  )
}

// ---------------------------------------------------------------------------
// Request-shaped call API
// ---------------------------------------------------------------------------

/** Normalize speech request input into a plain `SpeechRequest`. */
export const request = <const Model extends SpeechModel>(input: SpeechRequestInput<Model>): SpeechRequest<Model> => ({
  ...input,
  http: HttpOptions.make(input.http),
})

const validate = Schema.decodeUnknownSync(SpeechRequestSchema)

const requestEffect = (input: SpeechRequestInput) =>
  tryRequest(() => {
    const normalized = request(input)
    validate(normalized)
    return normalized
  })

export function generate<const Model extends SpeechModel>(
  input: SpeechRequestInput<Model>,
): Effect.Effect<SpeechResponse, AIError, Service>
export function generate(input: SpeechRequestInput) {
  return requestEffect(input).pipe(Effect.flatMap((request) => SpeechClient.generate(request)))
}

export function stream<const Model extends SpeechModel>(
  input: SpeechRequestInput<Model>,
): Stream.Stream<SpeechEvent, AIError, Service>
export function stream(input: SpeechRequestInput) {
  return Stream.unwrap(requestEffect(input).pipe(Effect.map((request) => SpeechClient.stream(request))))
}

export const Speech = {
  request,
  generate,
  stream,
} as const
