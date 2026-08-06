import { MaxUploadRequestBytes } from "@opencode-ai/protocol/groups/fs"
import { Effect } from "effect"
import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

/**
 * Rejects requests whose declared `content-length` exceeds the upload body
 * limit. This runs at the HTTP layer before the body is read, so oversized
 * requests (e.g. a multi-GB upload) never reach the route handler and are not
 * buffered in memory.
 */
export const contentLengthLimitMiddleware = HttpMiddleware.make((effect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const raw = request.headers["content-length"]
    if (raw !== undefined && Number(raw) > MaxUploadRequestBytes) {
      return HttpServerResponse.text(`Request body too large (max ${MaxUploadRequestBytes} bytes)`, {
        status: 413,
      })
    }
    return yield* effect
  }),
)
