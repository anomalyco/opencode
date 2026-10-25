/** JSON-compatible cassette metadata value. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

/** Additional JSON metadata stored with a cassette. */
export type CassetteMetadata = Readonly<Record<string, JsonValue>>

/** The normalized HTTP request representation used for matching. */
export interface RequestSnapshot {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: string
}

/** Returns whether an incoming HTTP request matches a recorded request. */
export type RequestMatcher = (incoming: RequestSnapshot, recorded: RequestSnapshot) => boolean

/** Additive redaction and header-preservation policy. */
export interface RedactOptions {
  readonly headers?: ReadonlyArray<string>
  readonly allowRequestHeaders?: ReadonlyArray<string>
  readonly allowResponseHeaders?: ReadonlyArray<string>
  readonly queryParameters?: ReadonlyArray<string>
  readonly jsonFields?: ReadonlyArray<string>
  readonly url?: (url: string) => string
  readonly body?: (body: string) => string
}

/** Options shared by HTTP recorder layers. */
export interface RecorderOptions {
  readonly directory?: string
  readonly metadata?: CassetteMetadata
  readonly redact?: RedactOptions
  readonly match?: RequestMatcher
}

/** Recorder configuration for Effect socket and WebSocket layers. */
export type SocketRecorderOptions = Omit<RecorderOptions, "match">

export * as Api from "./api.js"
