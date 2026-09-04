import { ForbiddenError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { CorsConfig, isAllowedRequestOrigin } from "../cors"
import { Push } from "../push"

export const PushHandler = HttpApiBuilder.group(Api, "server.push", (handlers) =>
  Effect.gen(function* () {
    const push = yield* Push.Service
    const cors = yield* CorsConfig
    const checkOrigin = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (!isAllowedRequestOrigin(request.headers.origin, request.headers.host, cors))
        yield* new ForbiddenError({ message: "Invalid Web Push request origin" })
    })
    return handlers
      .handle("push.get", () => push.get)
      .handle("push.subscribe", (request) =>
        checkOrigin.pipe(Effect.andThen(push.subscribe(request.payload)), Effect.as(HttpApiSchema.NoContent.make())),
      )
      .handle("push.unsubscribe", (request) =>
        checkOrigin.pipe(
          Effect.andThen(push.unsubscribe(request.params.id)),
          Effect.as(HttpApiSchema.NoContent.make()),
        ),
      )
  }),
)
