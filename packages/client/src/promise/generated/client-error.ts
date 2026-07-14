export type ClientErrorReason =
  | "Transport"
  | "UnexpectedStatus"
  | "UnsupportedContentType"
  | "MalformedResponse"
  | "SseEventTooLarge"

export class ClientError extends Error {
  override readonly name = "ClientError"
  constructor(
    readonly reason: ClientErrorReason,
    options?: ErrorOptions,
  ) {
    super(reason, options)
  }
}
