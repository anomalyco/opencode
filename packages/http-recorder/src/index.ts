import { http } from "./effect.js"
import { socket } from "./socket.js"

/** HTTP and WebSocket cassette recording. */
export const HttpRecorder = { http, socket } as const

export namespace HttpRecorder {
  /** Additional JSON metadata stored with a cassette. */
  export type CassetteMetadata = import("./types.js").CassetteMetadata
  /** Recorder configuration. */
  export type RecorderOptions = import("./types.js").RecorderOptions
  /** Additive redaction and header-preservation policy. */
  export type RedactOptions = import("./types.js").RedactOptions
  /** Returns whether an incoming HTTP request matches a recorded request. */
  export type RequestMatcher = import("./types.js").RequestMatcher
  /** The normalized HTTP request representation used for matching. */
  export type RequestSnapshot = import("./types.js").RequestSnapshot
}
