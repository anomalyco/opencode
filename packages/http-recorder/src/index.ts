import { Layer } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Socket } from "effect/unstable/socket"
import { Api } from "./api.js"
import { hasCassetteSync, removeCassetteSync } from "./cassette/store.js"
import { layer, layerFetch } from "./http/recorder.js"
import { layerSocket, layerWebSocketConstructor } from "./websocket/recorder.js"

/** HTTP and WebSocket cassette recording. */
export const HttpRecorder: {
  readonly layer: (
    name: string,
    options?: Api.RecorderOptions,
  ) => Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient>
  readonly layerFetch: (name: string, options?: Api.RecorderOptions) => Layer.Layer<HttpClient.HttpClient>
  readonly layerSocket: (
    name: string,
    options?: Api.SocketRecorderOptions,
  ) => Layer.Layer<Socket.Socket, never, Socket.Socket>
  readonly layerWebSocketConstructor: (
    name: string,
    options?: Api.SocketRecorderOptions,
  ) => Layer.Layer<Socket.WebSocketConstructor, never, Socket.WebSocketConstructor>
  readonly hasCassetteSync: (name: string, options?: { readonly directory?: string }) => boolean
  readonly removeCassetteSync: (name: string, options?: { readonly directory?: string }) => void
} = { hasCassetteSync, layer, layerFetch, layerSocket, layerWebSocketConstructor, removeCassetteSync }

export namespace HttpRecorder {
  /** Additional JSON metadata stored with a cassette. */
  export type JsonValue = Api.JsonValue
  /** Additional JSON metadata stored with a cassette. */
  export type CassetteMetadata = Api.CassetteMetadata
  /** Recorder configuration. */
  export type RecorderOptions = Api.RecorderOptions
  /** Additive redaction and header-preservation policy. */
  export type RedactOptions = Api.RedactOptions
  /** Returns whether an incoming HTTP request matches a recorded request. */
  export type RequestMatcher = Api.RequestMatcher
  /** The normalized HTTP request representation used for matching. */
  export type RequestSnapshot = Api.RequestSnapshot
  /** Recorder configuration for Effect socket and WebSocket layers. */
  export type SocketRecorderOptions = Api.SocketRecorderOptions
}
