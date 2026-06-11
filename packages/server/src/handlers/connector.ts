import { Connector } from "@opencode-ai/core/connector"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { InvalidRequestError } from "../errors"
import { response } from "../groups/location"

const authorize = <A, R>(effect: Effect.Effect<A, Connector.AuthorizationError, R>) =>
  effect.pipe(
    Effect.mapError(
      () =>
        new InvalidRequestError({
          message: "Authentication failed",
          kind: "connector_authorization",
        }),
    ),
  )

export const ConnectorHandler = HttpApiBuilder.group(Api, "server.connector", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "connector.list",
        Effect.fn(function* () {
          const service = yield* Connector.Service
          return yield* response(service.list())
        }),
      )
      .handle(
        "connector.get",
        Effect.fn(function* (ctx) {
          const service = yield* Connector.Service
          return yield* response(service.get(ctx.params.connectorID))
        }),
      )
      .handle(
        "connector.connect.key",
        Effect.fn(function* (ctx) {
          const service = yield* Connector.Service
          yield* authorize(
            service.connect.key({
              connectorID: ctx.params.connectorID,
              methodID: ctx.payload.methodID,
              key: ctx.payload.key,
              inputs: ctx.payload.inputs,
              label: ctx.payload.label,
            }),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "connector.connect.oauth.begin",
        Effect.fn(function* (ctx) {
          const service = yield* Connector.Service
          return yield* response(
            authorize(
              service.connect.oauth.begin({
                connectorID: ctx.params.connectorID,
                methodID: ctx.payload.methodID,
                inputs: ctx.payload.inputs,
                label: ctx.payload.label,
              }),
            ),
          )
        }),
      )
      .handle(
        "connector.connect.oauth.status",
        Effect.fn(function* (ctx) {
          const service = yield* Connector.Service
          return yield* response(service.connect.oauth.status(ctx.params.attemptID))
        }),
      )
      .handle(
        "connector.connect.oauth.complete",
        Effect.fn(function* (ctx) {
          const service = yield* Connector.Service
          yield* service.connect.oauth.complete({ attemptID: ctx.params.attemptID, code: ctx.payload.code }).pipe(
            Effect.mapError(
              (error) =>
                new InvalidRequestError({
                  message:
                    error._tag === "Connector.CodeRequired"
                      ? "Authorization code is required"
                      : "Authentication failed",
                  kind: error._tag === "Connector.CodeRequired" ? "connector_code_required" : "connector_authorization",
                }),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "connector.connect.oauth.cancel",
        Effect.fn(function* (ctx) {
          const service = yield* Connector.Service
          yield* service.connect.oauth.cancel(ctx.params.attemptID)
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
