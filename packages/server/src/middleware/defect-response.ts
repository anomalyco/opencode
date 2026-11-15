import { StorageFailure } from "@opencode/core/database/storage-failure"
import { UnknownError } from "@opencode/protocol/errors"
import { Cause, Effect } from "effect"
import { HttpRouter, HttpServerError, HttpServerRequest, HttpServerResponse } from "effect/http"

const respond = HttpServerResponse.schemaJson(UnknownError)

// Effect answers a failure it has no response for with an empty 500. Replace exactly that response's body, like the
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
          const body = yield* respond(
            new UnknownError({
              message:
                StorageFailure.message(cause) ?? "Server failed to handle the request. Check server logs for details.",
              ref,
            }),
            { status: 500 },
          ).pipe(Effect.orDie)
          // Fail with the response beside the original cause rather than succeed with it: Effect sends a response
          // found in a cause, and the request's span and response log still record the failure.
          return yield* Effect.failCause(Cause.combine(cause, Cause.die(body)))
        }),
      ),
    ),
  { global: true },
)
