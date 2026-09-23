import { Effect } from "effect"
import { Media } from "../../media.js"
import { MediaProtocol } from "../../route/media-protocol.js"
import type { AIError, MediaUsage, ProviderID, ProviderMetadata } from "../../schema/index.js"
import {
  SpeechAudioDeltaEvent,
  SpeechFinishEvent,
  SpeechTimestampsEvent,
  type SpeechEvent,
  type SpeechVoice,
} from "../../speech.js"
import { concatBytes } from "../../utils/bytes.js"
import { ProviderShared } from "../shared.js"

/** Every speech protocol's parser state collects the chunks it has emitted; `finish` concatenates them. */
export interface Audio {
  /** Appended in place: the route creates fresh state for each response through `initial`. */
  readonly chunks: Array<Uint8Array>
}

export type StepResult<State> = readonly [State, ReadonlyArray<SpeechEvent>]

/** Empty chunks (keep-alive records) emit nothing. */
export const delta = <State extends Audio>(state: State, chunk: Uint8Array): StepResult<State> => {
  if (chunk.length === 0) return [state, []]
  state.chunks.push(chunk)
  return [state, [SpeechAudioDeltaEvent.make({ chunk })]]
}

/** Text frames (SSE events, JSON records) go to the protocol's record handler; raw body chunks are audio. */
export const step =
  <State extends Audio>(onRecord: (state: State, frame: string) => Effect.Effect<StepResult<State>, AIError>) =>
  (state: State, frame: string | Uint8Array) =>
    typeof frame === "string" ? onRecord(state, frame) : Effect.succeed(delta(state, frame))

/** Parallel text, start, and end arrays (ElevenLabs characters, Cartesia words) as at most one `timestamps` event. */
export const timestamps = (
  texts: ReadonlyArray<string>,
  starts: ReadonlyArray<number>,
  ends: ReadonlyArray<number>,
): ReadonlyArray<SpeechEvent> =>
  texts.length === 0
    ? []
    : [
        SpeechTimestampsEvent.make({
          items: texts.map((text, index) => ({ text, startSeconds: starts[index] ?? 0, endSeconds: ends[index] ?? 0 })),
        }),
      ]

/** The provider-native identifier of a voice; `{ id }` and a plain string are the same outside OpenAI. */
export const voiceID = (voice: SpeechVoice | undefined) => (typeof voice === "object" ? voice.id : voice)

const CONTAINER_MEDIA_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
}

/** A container format's declared media type; unknown formats fall back to sniffing. */
export const container = (format: string, sampleRate?: number) => ({
  mediaType: CONTAINER_MEDIA_TYPES[format],
  info: { format, sampleRate },
})

const PCM_MEDIA_TYPES = {
  pcm_s16le: "audio/pcm",
  pcm_f32le: "audio/pcm",
  pcm_mulaw: "audio/mulaw",
  pcm_alaw: "audio/alaw",
} as const

export type PcmEncoding = keyof typeof PCM_MEDIA_TYPES

/** Headerless mono PCM: the provider's declared media type when it has one, plus the facts a player needs. */
export const pcm = (encoding: PcmEncoding, sampleRate: number | undefined, mediaType?: string) => ({
  mediaType: mediaType ?? PCM_MEDIA_TYPES[encoding],
  info: { format: "pcm", encoding, sampleRate, channels: 1 },
})

/** The `rate` parameter of a PCM media type such as `audio/L16;codec=pcm;rate=24000`. */
export const sampleRate = (mediaType: string | undefined) => {
  const rate = /rate=(\d+)/i.exec(mediaType ?? "")?.[1]
  return rate === undefined ? undefined : Number(rate)
}

/** A common `format` value this route cannot produce. */
export const unsupportedFormat = (provider: ProviderID, route: string, message: string) =>
  ProviderShared.unsupportedOperation({ operation: "media.format", provider, route, message })

/**
 * Concatenate every emitted chunk into the terminal event's asset. A declared `mediaType` wins over sniffing because
 * headerless PCM can start with bytes that look like an MPEG frame sync. `detail` explains an empty response.
 */
export const finish = (
  route: string,
  state: Audio,
  output: {
    readonly mediaType: string | undefined
    readonly info?: Media.Info
    readonly usage?: MediaUsage
    readonly providerMetadata?: ProviderMetadata
    readonly detail?: string
  },
): Effect.Effect<ReadonlyArray<SpeechEvent>, AIError> => {
  if (state.chunks.length === 0)
    return Effect.fail(
      MediaProtocol.frameError(
        route,
        `The provider returned no audio${output.detail === undefined ? "" : ` (${output.detail})`}`,
      ),
    )
  return Effect.succeed([
    SpeechFinishEvent.make({
      audio: Media.bytes(concatBytes(state.chunks), output.mediaType, { info: output.info }),
      usage: output.usage,
      providerMetadata: output.providerMetadata,
    }),
  ])
}

/** A numeric header such as ElevenLabs `character-cost` (credits) or Deepgram `dg-char-count`, lifted into usage. */
export const headerUsage = (type: "characters" | "credits", value: string | undefined): MediaUsage | undefined => {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return undefined
  return type === "credits" ? { type, credits: amount } : { type, characters: amount }
}

export * as SpeechStream from "./speech-stream.js"
