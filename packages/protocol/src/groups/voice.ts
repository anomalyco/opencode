import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError, LocationNotFoundError, ServiceUnavailableError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const VoiceTransportType = Schema.Literals(["webrtc", "websocket"]).annotate({
  identifier: "VoiceTransportType",
})

export const VoiceModel = Schema.Struct({
  model: Schema.String,
  provider: Schema.String,
  transports: Schema.Array(VoiceTransportType),
  available: Schema.Boolean,
}).annotate({ identifier: "VoiceModel" })

export const VoiceWebRTCTransportInput = Schema.Struct({
  type: Schema.Literal("webrtc"),
  sdp: Schema.String,
  dcid: Schema.optional(Schema.Number),
}).annotate({ identifier: "VoiceWebRTCTransportInput" })

export const VoiceWebSocketTransportInput = Schema.Struct({
  type: Schema.Literal("websocket"),
}).annotate({ identifier: "VoiceWebSocketTransportInput" })

export const VoiceTransportInput = Schema.Union([
  VoiceWebRTCTransportInput,
  VoiceWebSocketTransportInput,
]).annotate({ identifier: "VoiceTransportInput" })

export const VoiceWebRTCTransport = Schema.Struct({
  type: Schema.Literal("webrtc"),
  sdp: Schema.String,
}).annotate({ identifier: "VoiceWebRTCTransport" })

export const VoiceWebSocketTransport = Schema.Struct({
  type: Schema.Literal("websocket"),
  url: Schema.String,
  token: Schema.String,
  expiresAt: Schema.Number,
}).annotate({ identifier: "VoiceWebSocketTransport" })

export const VoiceTransport = Schema.Union([
  VoiceWebRTCTransport,
  VoiceWebSocketTransport,
]).annotate({ identifier: "VoiceTransport" })

export const VoiceGroup = HttpApiGroup.make("server.voice")
  .add(
    HttpApiEndpoint.get("voice.models", "/api/experimental/voice/models", {
      query: LocationQuery,
      success: Schema.Struct({
        data: Schema.Struct({
          models: Schema.Array(VoiceModel),
          default: Schema.optional(Schema.String),
        }),
      }).annotate({ identifier: "VoiceModelsResponse" }),
      error: [ServiceUnavailableError, LocationNotFoundError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.voice.models",
          summary: "List voice models",
          description:
            "List the voice models the server can start, one per model ID, and their transports. Every model listed is available. New clients should list realtime models with model.list instead.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("voice.session", "/api/experimental/voice/session", {
      query: LocationQuery,
      payload: Schema.Struct({
        model: Schema.String,
        provider: Schema.optional(Schema.String).annotate({
          description: "The model's provider. Without it, the model's own provider is preferred, then OpenCode.",
        }),
        session: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
        transport: VoiceTransportInput,
      }),
      success: Schema.Struct({
        data: Schema.Struct({
          transport: VoiceTransport,
        }),
      }).annotate({ identifier: "VoiceSessionResponse" }),
      error: [InvalidRequestError, ServiceUnavailableError, LocationNotFoundError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.voice.session",
          summary: "Create voice session",
          description:
            "Create a server-brokered voice session using the server's configured provider credentials and return the WebRTC SDP answer or WebSocket ephemeral token.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "voice",
      description: "Experimental server-brokered voice session routes.",
    }),
  )
