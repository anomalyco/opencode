import { layerSocketWithMode, type WebSocketRecorderOptions } from "./websocket/recorder.js"
import { Layer } from "effect"
import { Socket } from "effect/unstable/socket"

export { CassetteNotFoundError, hasCassetteSync, InvalidCassetteError, UnsafeCassetteError } from "./cassette/store.js"
export { cassetteLayer, recordingLayer, type RecordReplayMode, type RecordReplayOptions } from "./http/recorder.js"
export { redactHeaders, redactUrl } from "./redaction/redactor.js"
export { secretFindings, type SecretFinding } from "./redaction/secrets.js"
export { layerSocketWithMode } from "./websocket/recorder.js"
export const socketLayer = (
  name: string,
  connection: { readonly url: string; readonly headers?: Record<string, string> },
  options: WebSocketRecorderOptions & { readonly mode: "record" | "replay" },
): Layer.Layer<Socket.Socket, never, Socket.Socket> =>
  layerSocketWithMode(name, { ...options, open: { url: connection.url, headers: connection.headers ?? {} } })
export {
  makeWebSocketExecutor,
  type WebSocketConnection,
  type WebSocketExecutor,
  type WebSocketRecordReplayOptions,
  type WebSocketRequest,
} from "./websocket/executor.js"
export * as Cassette from "./cassette/store.js"
export * as Redactor from "./redaction/redactor.js"

export * as HttpRecorderInternal from "./internal.js"
