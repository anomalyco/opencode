import { Effect, Schema, Stream } from "effect"
import { Media } from "./media.js"
import { MediaModel, composeRoute, tryRequest } from "./media-model.js"
import { MediaRoute } from "./route/media.js"
import type { MediaProtocol } from "./route/media-protocol.js"
import { AIError, HttpOptions, MediaUsage, ProviderMetadata } from "./schema/index.js"
import { SpeechClient, Service } from "./speech-client.js"

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type SpeechOptions = Record<string, unknown>

export type SpeechRoute<Options extends SpeechOptions = SpeechOptions> = MediaRoute.StreamRoute<
  SpeechRequestFor<Options>,
  SpeechEvent,
  SpeechResponse
>

export class SpeechModel<Options extends SpeechOptions = SpeechOptions> extends MediaModel<
  SpeechRoute<Options>,
  Options
> {
  declare protected readonly _SpeechModel: void

  static make<Options extends SpeechOptions = SpeechOptions>(input: MediaModel.Input<SpeechRoute<Options>>) {
    return new SpeechModel<Options>(input)
  }

  /** Compose a streaming speech protocol with its canonical path into a model for one deployment. */
  static fromRoute<Options extends SpeechOptions = SpeechOptions, Frame = unknown, State = unknown>(
    route: SpeechModel.RouteInput<Options, Frame, State>,
    input: MediaRoute.ModelInput,
  ) {
    return new SpeechModel<Options>({
      id: input.id,
      provider: route.provider,
      http: input.http,
      route: composeRoute(
        (composition) => MediaRoute.stream({ ...composition, collect: collectResponse }),
        route,
        input,
      ),
    })
  }
}

export namespace SpeechModel {
  export type RouteInput<
    Options extends SpeechOptions = SpeechOptions,
    Frame = unknown,
    State = unknown,
  > = MediaModel.RouteInput<
    MediaProtocol.Addressed<SpeechRequestFor<Options>>,
    MediaProtocol.Streamed<SpeechRequestFor<Options>, SpeechEvent, Frame, State>
  >
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

export type SpeechFormat = "mp3" | "wav" | "pcm" | "opus" | "aac" | "flac" | (string & {})

/** Granularity is provider-native: characters on ElevenLabs, words on Cartesia. */
export const SpeechTimestamp = Schema.Struct({
  text: Schema.String,
  startSeconds: Schema.Number,
  endSeconds: Schema.Number,
}).annotate({ identifier: "Speech.Timestamp" })
export type SpeechTimestamp = Schema.Schema.Type<typeof SpeechTimestamp>

export class SpeechRequest extends Schema.Class<SpeechRequest>("Speech.Request")({
  model: SpeechModelSchema,
  text: Schema.String,
  voice: Schema.optional(SpeechVoice),
  format: Schema.optional(Schema.String),
  speed: Schema.optional(Schema.Number),
  language: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
  timestamps: Schema.optional(Schema.Boolean),
  providerOptions: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  http: Schema.optional(HttpOptions),
}) {
  declare protected readonly _SpeechRequest: void
}

export type SpeechRequestFor<Options extends SpeechOptions = SpeechOptions> = Omit<
  SpeechRequest,
  "model" | "providerOptions"
> & {
  readonly model: SpeechModel<Options>
  readonly providerOptions?: Options
}

export type SpeechModelOptions<Model> = Model extends SpeechModel<infer Options> ? Options : never

export type SpeechRequestInput<Model extends SpeechModel = SpeechModel> = Omit<
  ConstructorParameters<typeof SpeechRequest>[0],
  "model" | "providerOptions" | "http" | "format"
> & {
  readonly model: Model
  readonly format?: SpeechFormat
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
  notices: Schema.optional(Schema.Array(Media.Notice)),
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
  notices: Schema.optional(Schema.Array(Media.Notice)),
  providerMetadata: Schema.optional(ProviderMetadata),
}).annotate({ identifier: "Speech.Event.Finish" })

const speechEventTagged = Schema.Union([SpeechAudioDeltaEvent, SpeechTimestampsEvent, SpeechFinishEvent]).pipe(
  Schema.toTaggedUnion("type"),
)
export const SpeechEvent = Object.assign(speechEventTagged, {
  is: {
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
      notices: finish.notices,
      providerMetadata: finish.providerMetadata,
    }),
  )
}

// ---------------------------------------------------------------------------
// Request-shaped call API
// ---------------------------------------------------------------------------

export function request<const Model extends SpeechModel>(
  input: SpeechRequestInput<Model>,
): SpeechRequestFor<SpeechModelOptions<Model>>
export function request(input: SpeechRequest): SpeechRequest
export function request(input: SpeechRequest | SpeechRequestInput) {
  if (input instanceof SpeechRequest) return input
  return new SpeechRequest({
    ...input,
    http: input.http === undefined ? undefined : HttpOptions.make(input.http),
  })
}

const requestEffect = (input: SpeechRequest | SpeechRequestInput) => tryRequest(() => request(input))

export function generate<const Model extends SpeechModel>(
  input: SpeechRequestInput<Model>,
): Effect.Effect<SpeechResponse, AIError, Service>
export function generate(input: SpeechRequest): Effect.Effect<SpeechResponse, AIError, Service>
export function generate(input: SpeechRequest | SpeechRequestInput) {
  return requestEffect(input).pipe(Effect.flatMap((request) => SpeechClient.generate(request)))
}

export function stream<const Model extends SpeechModel>(
  input: SpeechRequestInput<Model>,
): Stream.Stream<SpeechEvent, AIError, Service>
export function stream(input: SpeechRequest): Stream.Stream<SpeechEvent, AIError, Service>
export function stream(input: SpeechRequest | SpeechRequestInput) {
  return Stream.unwrap(requestEffect(input).pipe(Effect.map((request) => SpeechClient.stream(request))))
}

export const Speech = {
  request,
  generate,
  stream,
} as const
