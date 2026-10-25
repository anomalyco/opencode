import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerRequest } from "effect/http"
import { ForbiddenError } from "@opencode/protocol/errors"
import { Api } from "../api"
import { CorsConfig, isAllowedRequestOrigin } from "../cors"
import { Push } from "../push"

export const PushHandler = HttpApiBuilder.group(Api, "server.push", (handlers) =>
  Effect.gen(function* () {
    const push = yield* Push.Service
    const cors = yield* CorsConfig

    const checkOrigin = (url?: string) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        if (!isAllowedRequestOrigin(request.headers.origin, request.headers.host, cors))
          return yield* new ForbiddenError({ message: "Invalid Web Push request origin" })
        // An authenticated page may only register a click target on its own origin. This
        // keeps a paired device from turning its subscription into an open redirect.
        if (url !== undefined && request.headers.origin !== undefined) {
          const target = URL.parse(url)
          if (!target || target.origin !== request.headers.origin)
            return yield* new ForbiddenError({ message: "Invalid Web Push session URL origin" })
        }
      })

    return handlers
      .handle("push.get", () => push.get)
      .handle("push.subscribe", (ctx) =>
        checkOrigin(ctx.payload.url).pipe(Effect.andThen(push.subscribe(ctx.payload)), Effect.map((result) => result.id)),
      )
      .handle("push.unsubscribe", (ctx) =>
        checkOrigin().pipe(Effect.andThen(push.unsubscribe(ctx.params.id)), Effect.as(undefined)),
      )
  }),
)
