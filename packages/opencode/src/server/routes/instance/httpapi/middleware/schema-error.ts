import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "server" })

// Default Respondable returns an empty 400 body. Match the NamedError shape
// used by other 4xx/5xx so the SDK's `wrapClientError` extracts `.data.message`.
export class SchemaErrorMiddleware extends HttpApiMiddleware.Service<SchemaErrorMiddleware>()(
  "@opencode/HttpApiSchemaError",
) {}

export const schemaErrorLayer = HttpApiMiddleware.layerSchemaErrorTransform(
  SchemaErrorMiddleware,
  (error) => {
    log.warn("schema rejection", { kind: error.kind, reason: error.cause.message })
    return Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        { name: "BadRequest", data: { message: error.cause.message, kind: error.kind } },
        { status: 400 },
      ),
    )
  },
)
