import { PositiveInt } from "@opencode/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationNotFoundError, ServiceUnavailableError } from "../errors.js"

const SpeechFormat = Schema.Union([
  Schema.Struct({ type: Schema.Literal("mp3") }),
  Schema.Struct({ type: Schema.Literal("pcm"), sampleRate: PositiveInt, channels: PositiveInt }).annotate({
    description: "Interleaved little-endian 16-bit samples.",
  }),
]).annotate({ identifier: "VoiceSpeechFormat" })

const SpeechEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("format"), format: SpeechFormat }),
  Schema.Struct({
    type: Schema.Literal("audio"),
    data: Schema.String.annotate({ description: "Base64-encoded audio bytes." }),
  }),
  Schema.Struct({ type: Schema.Literal("done") }),
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String }),
]).annotate({ identifier: "VoiceSpeechEvent" })

export const VoiceGroup = HttpApiGroup.make("server.voice")
  .add(
    HttpApiEndpoint.post("voice.transcribe", "/api/experimental/voice/transcribe", {
      query: {
        mediaType: Schema.String.annotate({ description: "Media type of the uploaded audio, such as audio/wav." }),
      },
      payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      success: Schema.Struct({
        data: Schema.Struct({ text: Schema.String }),
      }).annotate({ identifier: "VoiceTranscribeResponse" }),
      error: [ServiceUnavailableError, LocationNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.voice.transcribe",
        summary: "Transcribe speech",
        description: "Transcribe one recorded utterance with the configured voice.transcription model.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("voice.speech", "/api/experimental/voice/speech", {
      payload: Schema.Struct({ text: Schema.String }),
      success: HttpApiSchema.StreamSse({ data: SpeechEvent }),
      error: [ServiceUnavailableError, LocationNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.voice.speech",
        summary: "Synthesize speech",
        description:
          "Stream spoken audio for text with the configured voice.speech model. One format event precedes the audio chunks; done or error ends the stream.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "voice",
      description: "Experimental speech-to-text and text-to-speech routes.",
    }),
  )
