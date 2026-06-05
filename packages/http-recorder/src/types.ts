export type CassetteMetadata = Record<string, unknown>

export interface RequestSnapshot {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: string
}

export interface ResponseSnapshot {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: string
  readonly bodyEncoding?: "text" | "base64"
}

export interface HttpInteraction {
  readonly transport: "http"
  readonly request: RequestSnapshot
  readonly response: ResponseSnapshot
}

export type RequestMatcher = (incoming: RequestSnapshot, recorded: RequestSnapshot) => boolean

export interface RedactOptions {
  readonly headers?: ReadonlyArray<string>
  readonly allowRequestHeaders?: ReadonlyArray<string>
  readonly allowResponseHeaders?: ReadonlyArray<string>
  readonly queryParameters?: ReadonlyArray<string>
  readonly jsonFields?: ReadonlyArray<string>
  readonly url?: (url: string) => string
  readonly body?: (body: string) => string
}

export interface RecorderOptions {
  readonly directory?: string
  readonly metadata?: CassetteMetadata
  readonly redact?: RedactOptions
  readonly match?: RequestMatcher
}
