import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const VoiceGroup = HttpApiGroup.make("server.voice")
  .add(
    HttpApiEndpoint.post("voice.transcribe", "/api/voice/transcribe", {
      query: LocationQuery,
      payload: Schema.Struct({
        audio: Schema.String.annotate({
          description: "Base64 encoded audio recorded by the client",
        }),
        mime: Schema.String.annotate({
          description: "Audio mime type of the recorded payload",
        }),
        prompt: Schema.optional(Schema.String),
      }),
      success: Schema.Struct({
        text: Schema.String,
      }),
      error: [InvalidRequestError, ServiceUnavailableError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "voice.transcribe",
          summary: "Transcribe audio",
          description:
            "Send base64 encoded audio to the configured transcription endpoint and return the resulting text.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("voice.recording", "/api/voice/recording", {
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "voice.recording",
          summary: "Signal that a recording started",
          description:
            "Publishes a voice.recording event so integrations and plugins can react (for example, pre-warming a local transcription server).",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "voice", description: "Voice transcription routes." }))
