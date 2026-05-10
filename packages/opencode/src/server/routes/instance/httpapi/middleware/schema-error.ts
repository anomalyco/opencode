import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "server" })

// Effect's default Respondable for HttpApiSchemaError returns 400 with an
// empty body. That gives the renderer / SDK / curl no information about
// what was actually rejected (Body field, Query param, etc.). PR #26457
// previously tried `{data:{}, errors:[], success:false}` and broke a
// plugin (#26546) — root cause was the SDK throwing raw POJOs instead
// of Errors, which has since been fixed by `wrapClientError`.
//
// We use the same shape every other 4xx/5xx in the API already uses —
// NamedError serialization (`{name, data}`). The SDK's `wrapClientError`
// extracts `.data.message` automatically, so plugins that already handle
// 404 NotFoundError bodies handle this with no changes.
export class SchemaErrorMiddleware extends HttpApiMiddleware.Service<SchemaErrorMiddleware>()(
  "@opencode/HttpApiSchemaError",
) {}

export const schemaErrorLayer = HttpApiMiddleware.layerSchemaErrorTransform(
  SchemaErrorMiddleware,
  (error) =>
    Effect.gen(function* () {
      log.warn("schema rejection", {
        kind: error.kind,
        reason: error.cause.message,
      })
      return HttpServerResponse.jsonUnsafe(
        {
          name: "BadRequest",
          data: {
            message: error.cause.message,
            kind: error.kind,
          },
        },
        { status: 400 },
      )
    }),
)
