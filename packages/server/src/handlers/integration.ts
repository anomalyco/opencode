import { Integration } from "@opencode-ai/core/integration"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { response } from "../location"
import { WellKnown } from "@opencode-ai/core/wellknown"

const authorize = <A, R>(effect: Effect.Effect<A, Integration.AuthorizationError, R>) =>
  effect.pipe(
    Effect.mapError(
      (error) =>
        new InvalidRequestError({
          message:
            error.cause instanceof Error && error.cause.message.trim() ? error.cause.message : "Authentication failed",
          kind: "integration_authorization",
        }),
    ),
  )

export const IntegrationHandler = HttpApiBuilder.group(Api, "server.integration", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "integration.list",
        Effect.fn(function* () {
          const service = yield* Integration.Service
          return yield* response(service.list())
        }),
      )
      .handle(
        "integration.get",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(service.get(ctx.params.integrationID))
        }),
      )
      .handle(
        "integration.wellknown.add",
        Effect.fn(function* (ctx) {
          const wellknown = yield* WellKnown.Service
          const integration = yield* Integration.Service
          yield* wellknown
            .add(ctx.payload.url)
            .pipe(
              Effect.mapError(
                (error) => new InvalidRequestError({ message: error.message, kind: "well_known_discovery" }),
              ),
            )
          yield* integration.reload()
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "integration.connect.key",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* authorize(
            service.connection.key({
              integrationID: ctx.params.integrationID,
              key: ctx.payload.key,
              answer: ctx.payload.answer,
              label: ctx.payload.label,
            }),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "integration.oauth.connect",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(
            authorize(
              service.oauth.connect({
                integrationID: ctx.params.integrationID,
                methodID: ctx.payload.methodID,
                answer: ctx.payload.answer,
                label: ctx.payload.label,
              }),
            ),
          )
        }),
      )
      .handle(
        "integration.oauth.status",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(
            service.oauth.status({
              integrationID: ctx.params.integrationID,
              attemptID: ctx.params.attemptID,
            }),
          )
        }),
      )
      .handle(
        "integration.oauth.complete",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* service.oauth
            .complete({
              integrationID: ctx.params.integrationID,
              attemptID: ctx.params.attemptID,
              code: ctx.payload.code,
            })
            .pipe(
              Effect.mapError(
                (error) =>
                  new InvalidRequestError({
                    message:
                      error._tag === "Integration.CodeRequired"
                        ? "Authorization code is required"
                        : "Authentication failed",
                    kind:
                      error._tag === "Integration.CodeRequired"
                        ? "integration_code_required"
                        : "integration_authorization",
                  }),
              ),
            )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "integration.oauth.cancel",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* service.oauth.cancel({
            integrationID: ctx.params.integrationID,
            attemptID: ctx.params.attemptID,
          })
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "integration.command.connect",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(
            authorize(
              service.command.connect({
                integrationID: ctx.params.integrationID,
                methodID: ctx.payload.methodID,
                label: ctx.payload.label,
              }),
            ),
          )
        }),
      )
      .handle(
        "integration.command.status",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(
            service.command.status({
              integrationID: ctx.params.integrationID,
              attemptID: ctx.params.attemptID,
            }),
          )
        }),
      )
      .handle(
        "integration.command.cancel",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* service.command.cancel({
            integrationID: ctx.params.integrationID,
            attemptID: ctx.params.attemptID,
          })
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
