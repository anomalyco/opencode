import { StorageFailure } from "@opencode/core/database/storage-failure"
import { UnknownError } from "@opencode/protocol/errors"
import { Cause, Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

// A defect in a handler otherwise reaches the client as a 500 with an empty body. Answer it like the encoding failure
// in schema-error.ts instead: the reason when it's one a person can act on (a storage failure), otherwise a ref to
// find it in the server log. Other causes, such as route-not-found, keep their own responses.
export const defectResponseLayer = HttpRouter.middleware(
  (effect) =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          if (!cause.reasons.some(Cause.isDieReason)) return yield* Effect.failCause(cause)
          const request = yield* HttpServerRequest.HttpServerRequest
          const ref = `err_${crypto.randomUUID().slice(0, 8)}`
          yield* Effect.logError("request failed", cause).pipe(
            Effect.annotateLogs({ ref, route: `${request.method} ${request.url}` }),
          )
          return HttpServerResponse.jsonUnsafe(
            {
              _tag: "UnknownError",
              message:
                StorageFailure.message(cause) ?? "Server failed to handle the request. Check server logs for details.",
              ref,
            } satisfies typeof UnknownError.Encoded,
            { status: 500 },
          )
        }),
      ),
    ),
  { global: true },
)
