import { Effect } from "effect"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors"

const REASON_LIMIT = 1024

function truncateReason(reason: string) {
  if (reason.length <= REASON_LIMIT) return reason
  return reason.slice(0, REASON_LIMIT) + `... (${reason.length - REASON_LIMIT} more chars)`
}

export class SchemaErrorMiddleware extends HttpApiMiddleware.Service<SchemaErrorMiddleware>()(
  "@opencode/HttpApiSchemaError",
  { error: InvalidRequestError },
) {}

export const schemaErrorLayer = HttpApiMiddleware.layerSchemaErrorTransform(SchemaErrorMiddleware, (error) => {
  const reason = truncateReason(error.cause.message)
  return Effect.logWarning("schema rejection").pipe(
    Effect.annotateLogs({ kind: error.kind, reason }),
    Effect.andThen(Effect.fail(new InvalidRequestError({ message: reason, kind: error.kind }))),
  )
})
