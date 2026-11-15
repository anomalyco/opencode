import { StorageFailure } from "@opencode/core/database/storage-failure"
import { UnknownError } from "@opencode/protocol/errors"
import { Effect } from "effect"
import { HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse } from "effect/http"

// Effect answers a failure it has no response for with an empty 500. Replace exactly that response, like the
// encoding failure in schema-error.ts: the reason when it's one a person can act on (a storage failure), otherwise a
// ref to find it in the server log. Every cause Effect already answers (declared errors, route-not-found, defects that
// carry their own response, aborts) keeps its response.
export const defectResponseLayer = HttpRouter.middleware(
  (effect) =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.gen(function* () {
          const [response] = yield* HttpServerError.causeResponse(cause)
          if (response.status !== 500 || response.body._tag !== "Empty") return yield* Effect.failCause(cause)
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
