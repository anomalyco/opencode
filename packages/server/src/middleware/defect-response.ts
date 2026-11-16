import { StorageFailure } from "@opencode/core/database/storage-failure"
import { UnknownError } from "@opencode/protocol/errors"
import { DefectResponseMiddleware } from "@opencode/protocol/middleware/defect-response"
export { DefectResponseMiddleware } from "@opencode/protocol/middleware/defect-response"
import { Cause, Effect, Layer } from "effect"
import { HttpServerError, HttpServerRequest } from "effect/http"

// Effect answers a failure it has no response for with an empty 500. Replace exactly that response's body, like the
// encoding failure in schema-error.ts: the reason when it's one a person can act on (a storage failure), otherwise a
// ref to find it in the server log. Every cause Effect already answers (declared errors, route-not-found, defects that
// carry their own response, aborts) keeps its response.
export const defectResponseLayer = Layer.succeed(DefectResponseMiddleware, (effect) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        // A typed failure is a declared error. HttpApi encodes it from the endpoint's error set, which this
        // middleware's UnknownError belongs to, so causeResponse only ever sees an empty 500 for it here.
        if (Cause.hasFails(cause)) return yield* Effect.failCause(cause)
        const [response] = yield* HttpServerError.causeResponse(cause)
        if (response.status !== 500 || response.body._tag !== "Empty") return yield* Effect.failCause(cause)
        const request = yield* HttpServerRequest.HttpServerRequest
        const ref = `err_${crypto.randomUUID().slice(0, 8)}`
        yield* Effect.logError("request failed", cause).pipe(
          Effect.annotateLogs({ ref, route: `${request.method} ${request.url}` }),
        )
        return yield* Effect.fail(
          new UnknownError({
            message:
              StorageFailure.message(cause) ?? "Server failed to handle the request. Check server logs for details.",
            ref,
          }),
        )
      }),
    ),
  ),
)
