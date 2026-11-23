import { Location } from "@opencode/schema/location"
import { Model } from "@opencode/schema/model"
import { NonNegativeInt, optional } from "@opencode/schema/schema"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/http-api"
import {
  InvalidRequestError,
  LocationNotFoundError,
  ModelNotFoundError,
  ServiceUnavailableError,
  UnsupportedModelError,
} from "../errors.js"
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

export const VoiceTransportInput = Schema.Union([VoiceWebRTCTransportInput, VoiceWebSocketTransportInput]).annotate({
  identifier: "VoiceTransportInput",
})

export const VoiceConnectWebRTCTransportInput = Schema.Struct({
  type: Schema.Literal("webrtc"),
  sdp: Schema.String,
  dcid: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "VoiceConnectWebRTCTransportInput" })

export const VoiceConnectTransportInput = Schema.Union([
  VoiceConnectWebRTCTransportInput,
  VoiceWebSocketTransportInput,
]).annotate({ identifier: "VoiceConnectTransportInput" })

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

export const VoiceTransport = Schema.Union([VoiceWebRTCTransport, VoiceWebSocketTransport]).annotate({
  identifier: "VoiceTransport",
})

export const makeVoiceGroup = <LocationId extends HttpApiMiddleware.AnyId, LocationService>(
  locationMiddleware: Context.Key<LocationId, LocationService>,
) =>
  HttpApiGroup.make("server.voice")
    .add(
      HttpApiEndpoint.post("voice.connect", "/api/experimental/voice/connect", {
        query: LocationQuery,
        payload: Schema.Struct({
          model: Model.Ref,
          session: Schema.Record(Schema.String, Schema.Unknown).pipe(optional),
          transport: VoiceConnectTransportInput,
        }),
        success: Location.response(VoiceTransport),
        error: [InvalidRequestError, ModelNotFoundError, UnsupportedModelError, ServiceUnavailableError],
      })
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.voice.connect",
            summary: "Connect a voice session",
            description:
              "Start a voice session with a realtime model from model.list, using the provider's credentials on the server, and return the WebRTC SDP answer or WebSocket ephemeral token. Experimental: may change without compatibility guarantees.",
          }),
        ),
    )
    .middleware(locationMiddleware)
    // Kept unchanged for clients built before voice models were in the model list; delete with core/src/voice-legacy.ts.
    .add(
      HttpApiEndpoint.get("voice.models", "/api/experimental/voice/models", {
        success: Schema.Struct({
          data: Schema.Struct({
            models: Schema.Array(VoiceModel),
            default: Schema.optional(Schema.String),
          }),
        }).annotate({ identifier: "VoiceModelsResponse" }),
        error: [ServiceUnavailableError, LocationNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.voice.models",
          summary: "List voice models (deprecated)",
          description: "Deprecated: list realtime models with model.list instead.",
          deprecated: true,
        }),
      ),
    )
    .add(
      HttpApiEndpoint.post("voice.session", "/api/experimental/voice/session", {
        payload: Schema.Struct({
          model: Schema.String,
          session: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
          transport: VoiceTransportInput,
        }),
        success: Schema.Struct({
          data: Schema.Struct({
            transport: VoiceTransport,
          }),
        }).annotate({ identifier: "VoiceSessionResponse" }),
        error: [InvalidRequestError, ServiceUnavailableError, LocationNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.voice.session",
          summary: "Create voice session (deprecated)",
          description: "Deprecated: use POST /api/experimental/voice/connect instead.",
          deprecated: true,
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "voice",
        description: "Experimental server-brokered voice session routes.",
      }),
    )
