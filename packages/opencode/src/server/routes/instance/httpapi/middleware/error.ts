import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { NotFoundError } from "@/storage/storage"
import { iife } from "@/util/iife"
import { NamedError } from "@opencode-ai/core/util/error"
import * as Log from "@opencode-ai/core/util/log"
import { Cause, Effect } from "effect"
import { HttpRouter, HttpServerError, HttpServerRespondable, HttpServerResponse } from "effect/unstable/http"
import { HttpApiError } from "effect/unstable/httpapi"
import { HttpApiSchemaError } from "effect/unstable/httpapi/HttpApiError"

const log = Log.create({ service: "server" })

function badRequestResponse() {
  return HttpServerResponse.jsonUnsafe(
    {
      data: {},
      errors: [],
      success: false,
    },
    { status: 400 },
  )
}

function normalizeEmptyBadRequest(response: HttpServerResponse.HttpServerResponse) {
  if (response.status !== 400 || response.body._tag !== "Empty") return response
  return badRequestResponse()
}

// Keep typed HttpApi failures on their declared error path; this boundary only replaces defect-only empty 500s.
export const errorLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  effect.pipe(
    Effect.catch((error) => {
      if (error instanceof HttpApiError.BadRequest) return Effect.succeed(badRequestResponse())
      return Effect.fail(error)
    }),
    Effect.map(normalizeEmptyBadRequest),
    Effect.catchCause((cause) => {
      const schemaError = cause.reasons.filter(Cause.isDieReason).find((reason) => HttpApiSchemaError.is(reason.defect))
      if (schemaError) return Effect.succeed(badRequestResponse())

      const defect = cause.reasons.filter(Cause.isDieReason).find((reason) => {
        if (HttpServerResponse.isHttpServerResponse(reason.defect)) return false
        if (HttpServerError.isHttpServerError(reason.defect)) return false
        if (HttpServerRespondable.isRespondable(reason.defect)) return false
        return true
      })
      if (!defect) return Effect.failCause(cause)

      const error = defect.defect
      log.error("failed", { error, cause: Cause.pretty(cause) })

      if (error instanceof NamedError) {
        return Effect.succeed(
          HttpServerResponse.jsonUnsafe(error.toObject(), {
            status: iife(() => {
              if (error instanceof NotFoundError) return 404
              if (error instanceof Provider.ModelNotFoundError) return 400
              if (error.name === "ProviderAuthValidationFailed") return 400
              if (error.name.startsWith("Worktree")) return 400
              return 500
            }),
          }),
        )
      }
      if (error instanceof Session.BusyError) {
        return Effect.succeed(
          HttpServerResponse.jsonUnsafe(new NamedError.Unknown({ message: error.message }).toObject(), {
            status: 400,
          }),
        )
      }

      return Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          new NamedError.Unknown({
            message: error instanceof Error && error.stack ? error.stack : String(error),
          }).toObject(),
          { status: 500 },
        ),
      )
    }),
  ),
).layer
