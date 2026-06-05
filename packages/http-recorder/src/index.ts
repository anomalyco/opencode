import { defaultMatcher, layer, layerFetch } from "./effect.js"
import { layerSocket, layerWebSocket } from "./socket.js"

export { defaultMatcher, layer, layerFetch, layerSocket, layerWebSocket }
export type {
  CassetteMetadata,
  RecorderOptions,
  RedactOptions,
  RequestMatcher,
  RequestSnapshot,
  WebSocketRecorderOptions,
  WebSocketRequest,
} from "./types.js"

/** HTTP and WebSocket cassette recorder layers. */
export const HttpRecorder = {
  defaultMatcher,
  layer,
  layerFetch,
  layerSocket,
  layerWebSocket,
} as const

export namespace HttpRecorder {
  /** Additional JSON metadata stored with a cassette. */
  export type CassetteMetadata = import("./types.js").CassetteMetadata
  /** Options shared by HTTP recorder layers. */
  export type RecorderOptions = import("./types.js").RecorderOptions
  /** Additive redaction and header-preservation policy. */
  export type RedactOptions = import("./types.js").RedactOptions
  /** Returns whether an incoming HTTP request matches a recorded request. */
  export type RequestMatcher = import("./types.js").RequestMatcher
  /** The normalized HTTP request representation used for matching. */
  export type RequestSnapshot = import("./types.js").RequestSnapshot
  /** Options shared by WebSocket recorder layers. */
  export type WebSocketRecorderOptions = import("./types.js").WebSocketRecorderOptions
  /** Handshake identity used to match a custom upstream socket. */
  export type WebSocketRequest = import("./types.js").WebSocketRequest
}
