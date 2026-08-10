import { DatabaseMaintenanceGate } from "@opencode-ai/core/database/maintenance-gate"
import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { ServiceUnavailableError } from "../errors"

const readMethods = new Set(["GET", "HEAD", "OPTIONS"])
const controlPaths = [
  /^\/session\/[^/]+\/abort$/,
  /^\/session\/[^/]+\/permissions\/[^/]+$/,
  /^\/permission\/[^/]+\/reply$/,
  /^\/question\/[^/]+\/(?:reply|reject)$/,
  /^\/tui\/control\/response$/,
  /^\/api\/session\/[^/]+\/interrupt$/,
  /^\/api\/session\/[^/]+\/permission\/[^/]+\/reply$/,
  /^\/api\/session\/[^/]+\/question\/[^/]+\/(?:reply|reject)$/,
]

function pathOf(url: string) {
  const query = url.indexOf("?")
  return query === -1 ? url : url.slice(0, query)
}

export function bypassesMaintenanceGate(method: string, url: string) {
  if (readMethods.has(method)) return true
  const path = pathOf(url)
  if (/^\/global\/storage(?:\/|$)/.test(path)) return true
  return false
}

export function isMaintenanceControlPath(url: string) {
  const path = pathOf(url)
  return controlPaths.some((pattern) => pattern.test(path))
}

export const maintenanceGateLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (bypassesMaintenanceGate(request.method, request.url)) return yield* effect

    // While draining, the runner's existing lease keeps maintenance blocked until
    // its permission/question/interrupt response has been fully processed.
    if (isMaintenanceControlPath(request.url) && DatabaseMaintenanceGate.status().phase === "draining")
      return yield* effect

    return yield* DatabaseMaintenanceGate.mutationOrElse(effect, (error) =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          new ServiceUnavailableError({
            message: `Database ${error.operation} maintenance is active. Retry after it finishes.`,
            service: "storage-maintenance",
          }),
          { status: 503, headers: { "retry-after": "5" } },
        ),
      ),
    )
  }),
).layer
