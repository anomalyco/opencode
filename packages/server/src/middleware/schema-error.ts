import { Effect } from "effect"
import { HttpServerResponse } from "effect/http"
import { HttpApiMiddleware } from "effect/http-api"
import { InvalidRequestError, UnknownError } from "@opencode/protocol/errors"
import { SchemaErrorMiddleware } from "@opencode/protocol/middleware/schema-error"
export { SchemaErrorMiddleware } from "@opencode/protocol/middleware/schema-error"

const REASON_LIMIT = 1024

function truncateReason(reason: string) {
  if (reason.length <= REASON_LIMIT) return reason
  return reason.slice(0, REASON_LIMIT) + `... (${reason.length - REASON_LIMIT} more chars)`
}

export const schemaErrorLayer = HttpApiMiddleware.layerSchemaErrorTransform(
  SchemaErrorMiddleware,
  (error, context) => {
    const reason = truncateReason(error.cause.message)
    // Effect tags response encoding as Body or ResponseHeaders; request decoding uses Params, Headers, Query or Payload.
    if (error.kind === "Body" || error.kind === "ResponseHeaders") {
      const ref = `err_${crypto.randomUUID().slice(0, 8)}`
      return Effect.logError("failed to encode response").pipe(
        Effect.annotateLogs({
          ref,
          kind: error.kind,
          endpoint: `${context.group.identifier}.${context.endpoint.name}`,
          route: `${context.endpoint.method} ${context.endpoint.path}`,
          reason,
        }),
        // Respond directly rather than failing with a declared error, so every endpoint's contract stays unchanged
        // and this 500 reads like any other unexpected server failure.
        Effect.as(
          HttpServerResponse.jsonUnsafe(
            {
              _tag: "UnknownError",
              message: "Server failed to encode its response. Check server logs for details.",
              ref,
            } satisfies typeof UnknownError.Encoded,
            { status: 500 },
          ),
        ),
      )
    }
    return Effect.logWarning("schema rejection").pipe(
      Effect.annotateLogs({ kind: error.kind, reason }),
      Effect.andThen(Effect.fail(new InvalidRequestError({ message: reason, kind: error.kind }))),
    )
  },
)
