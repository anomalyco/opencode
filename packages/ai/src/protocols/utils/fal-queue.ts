import { Effect, Schema } from "effect"
import type { HttpClientResponse } from "effect/unstable/http"
import type { Status } from "../../generation.js"
import type { Media } from "../../media.js"
import { MediaProtocol } from "../../route/media-protocol.js"
import type { AIError } from "../../schema/index.js"
import { ProviderShared, optionalNull } from "../shared.js"

export const DEFAULT_BASE_URL = "https://queue.fal.run"

/** fal hands back absolute follow-up URLs on submit; they are authoritative for status, result, and cancel. */
export const Token = Schema.Struct({
  requestID: Schema.String,
  statusURL: Schema.String,
  responseURL: Schema.String,
  cancelURL: Schema.String,
})
export type Token = Schema.Schema.Type<typeof Token>

const StartResponse = Schema.Struct({
  request_id: Schema.String,
  status_url: Schema.String,
  response_url: Schema.String,
  cancel_url: Schema.String,
  queue_position: optionalNull(Schema.Number),
})

const QueueStatus = Schema.Struct({
  status: Schema.String,
  queue_position: optionalNull(Schema.Number),
  error: optionalNull(Schema.Unknown),
})

const STATUS = {
  IN_QUEUE: "queued",
  IN_PROGRESS: "running",
  COMPLETED: "completed",
} as const satisfies Record<string, Status>

// fal accepts public URLs and data URIs; there is no provider file handle to forward.
export const mediaUrl = (asset: Media.Asset, name: string) =>
  ProviderShared.mediaReference(asset, undefined, name).pipe(Effect.map((reference) => reference.value))

export const protocol = <Request, Response>(
  route: MediaProtocol.Identity,
  input: {
    readonly unsupported?: ReadonlyArray<keyof Request & string>
    readonly from: (request: Request) => Effect.Effect<MediaProtocol.Body, AIError>
    readonly decodeResult: (
      response: HttpClientResponse.HttpClientResponse,
      context: MediaProtocol.PollContext<Token>,
    ) => Effect.Effect<Response, AIError>
  },
) => {
  const decodeQueueStatus = route.decodeJson(QueueStatus)
  return MediaProtocol.queued<Request, Response, Token>(route, {
    token: Token,
    unsupported: input.unsupported,
    start: {
      body: { from: input.from },
      decode: route.decodeStarted(StartResponse, (value) => ({
        token: {
          requestID: value.request_id,
          statusURL: value.status_url,
          responseURL: value.response_url,
          cancelURL: value.cancel_url,
        },
        snapshot: { id: value.request_id, status: "queued", position: value.queue_position ?? undefined },
      })),
    },
    status: {
      path: (token) => token.statusURL,
      decode: Effect.fn("FalQueue.decodeStatus")(function* (response, context) {
        const output = yield* decodeQueueStatus(response)
        const decoded = output.value
        const status = yield* MediaProtocol.status(STATUS, decoded.status, output)
        // fal reports request failures as COMPLETED with an `error`; the response endpoint carries the details.
        const failed = status === "completed" && decoded.error !== undefined && decoded.error !== null
        return {
          id: context.token.requestID,
          status: failed ? "failed" : status,
          position: status === "queued" ? (decoded.queue_position ?? undefined) : undefined,
        }
      }),
    },
    result: { path: (token) => token.responseURL, decode: input.decodeResult },
    cancel: { method: "PUT", path: (token) => token.cancelURL },
  })
}

export * as FalQueue from "./fal-queue.js"
