import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { NotFoundError } from "@/storage/storage"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"

// Query fields this middleware reads from the URL. Spread into every
// endpoint query schema in groups that apply RouteContextMiddleware,
// otherwise HttpApi rejects requests carrying these params with 400.
// HttpApiMiddleware in effect-smol cannot declare query params today —
// remove this once upstream supports middleware-declared query schemas.
export const RoutingQueryFields = {
  directory: Schema.optional(Schema.String),
}

export const RoutingQuery = Schema.Struct(RoutingQueryFields)

export class RouteContext extends Context.Service<RouteContext, { readonly directory: string }>()(
  "@opencode/ExperimentalHttpApiRouteContext",
) {}

export class RouteContextMiddleware extends HttpApiMiddleware.Service<
  RouteContextMiddleware,
  {
    provides: RouteContext
    requires: Session.Service
  }
>()("@opencode/ExperimentalHttpApiRouting") {}

function requestURL(request: HttpServerRequest.HttpServerRequest): URL {
  return new URL(request.url, "http://localhost")
}

function defaultDirectory(request: HttpServerRequest.HttpServerRequest, url: URL): string {
  const header = request.headers["x-opencode-directory"]
  return url.searchParams.get("directory") || (header ? decode(header) : process.cwd())
}

function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

export const routeContextLayer = Layer.effect(
  RouteContextMiddleware,
  Effect.gen(function* () {
    return RouteContextMiddleware.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const url = requestURL(request)
        const route = yield* HttpRouter.RouteContext
        const sessionID = route.params.sessionID
        const session = sessionID
          ? yield* Session.Service.use((svc) => svc.get(SessionID.make(sessionID))).pipe(
              Effect.catchIf(
                (error): error is NotFoundError => NotFoundError.isInstance(error),
                () => Effect.succeed(undefined),
              ),
            )
          : undefined
        const directory = session?.directory || defaultDirectory(request, url)
        return yield* effect.pipe(Effect.provideService(RouteContext, RouteContext.of({ directory })))
      }),
    )
  }),
)
