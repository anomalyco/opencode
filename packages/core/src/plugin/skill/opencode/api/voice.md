# voice

## GET /api/experimental/voice/models (experimental)

List supported voice models, their transports, and whether the server has a usable API key for each provider.

Returns: `VoiceModelsResponse`

## POST /api/experimental/voice/session (experimental)

Create a server-brokered voice session using the server's configured provider credentials and return the WebRTC SDP answer or WebSocket ephemeral token.

Body:
- `model: string`
- `session?: Record<string, unknown>`
- `transport: VoiceTransportInput`

Returns: `VoiceSessionResponse`

## Types

- `VoiceModelsResponse`: `{ data: { models, default } }`
- `VoiceSessionResponse`: `{ data: { transport } }`
- `VoiceTransportInput`: `VoiceWebRTCTransportInput | VoiceWebSocketTransportInput`
- `VoiceWebRTCTransportInput`: `{ type: "webrtc"; sdp: string; dcid?: number }`
- `VoiceWebSocketTransportInput`: `{ type: "websocket" }`
