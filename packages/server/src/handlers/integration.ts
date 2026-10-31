import { Integration } from "@opencode/core/integration"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Api } from "../api"
import {
  IntegrationAttemptNotFoundError,
  IntegrationMethodNotFoundError,
  IntegrationNotFoundError,
  InvalidRequestError,
} from "@opencode/protocol/errors"
import { awaitPlugins, response } from "../location"
import { WellKnown } from "@opencode/core/wellknown"
import { Config } from "@opencode/core/config"
import { ManagedPolicy } from "@opencode/core/managed-policy"

const statements = Effect.fnUntraced(function* () {
  const config = yield* Config.Service
  return ManagedPolicy.statements(yield* config.entries())
})

// MCP OAuth logins skip integration policy: whether an MCP server is available at all is decided by `mcp.use` and by
// managed policy withholding the documents of denied integrations.
const isMcp = (integration: { readonly metadata?: { readonly source?: unknown } } | undefined) =>
  integration?.metadata?.source === "mcp"

// `integration.connect` decides which integrations are listed and can be connected. Credential creation shares it.
export const requireConnectable = Effect.fnUntraced(function* (integrationID: Integration.ID) {
  const integrations = yield* Integration.Service
  if (isMcp(yield* integrations.get(integrationID))) return
  const denied = ManagedPolicy.match(yield* statements(), "integration.connect", integrationID)
  if (denied?.effect !== "deny") return
  return yield* new InvalidRequestError({
    message: `${denied.message}: connecting ${integrationID} is not allowed`,
    kind: "integration_policy",
  })
})

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
          yield* awaitPlugins
          const service = yield* Integration.Service
          const current = yield* statements()
          return yield* response(
            service
              .list()
              .pipe(
                Effect.map((integrations) =>
                  integrations.filter(
                    (integration) =>
                      isMcp(integration) ||
                      ManagedPolicy.decision(current, "integration.connect", integration.id) !== "deny",
                  ),
                ),
              ),
          )
        }),
      )
      .handle(
        "integration.get",
        Effect.fn(function* (ctx) {
          yield* awaitPlugins
          const service = yield* Integration.Service
          const integration = yield* service.get(ctx.params.integrationID)
          if (!integration)
            return yield* new IntegrationNotFoundError({
              integrationID: ctx.params.integrationID,
              message: `Integration not found: ${ctx.params.integrationID}`,
            })
          return yield* response(Effect.succeed(integration))
        }),
      )
      .handle(
        "integration.wellknown.add",
        Effect.fn(function* (ctx) {
          const wellknown = yield* WellKnown.Service
          const integration = yield* Integration.Service
          // Well-known sources are integrations keyed by their origin as entered.
          yield* requireConnectable(Integration.ID.make(ctx.payload.url.replace(/\/+$/, "")))
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
          yield* awaitPlugins
          yield* requireConnectable(ctx.params.integrationID)
          const service = yield* Integration.Service
          if (!(yield* service.get(ctx.params.integrationID)))
            return yield* new IntegrationNotFoundError({
              integrationID: ctx.params.integrationID,
              message: `Integration not found: ${ctx.params.integrationID}`,
            })
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
        "integration.connect.external",
        Effect.fn(function* (ctx) {
          yield* awaitPlugins
          yield* requireConnectable(ctx.params.integrationID)
          const service = yield* Integration.Service
          if (!(yield* service.get(ctx.params.integrationID)))
            return yield* new IntegrationNotFoundError({
              integrationID: ctx.params.integrationID,
              message: `Integration not found: ${ctx.params.integrationID}`,
            })
          yield* authorize(
            service.connection.external({
              integrationID: ctx.params.integrationID,
              methodID: ctx.payload.methodID,
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
          yield* awaitPlugins
          yield* requireConnectable(ctx.params.integrationID)
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
          yield* awaitPlugins
          const service = yield* Integration.Service
          if (!(yield* service.get(ctx.params.integrationID)))
            return yield* new IntegrationNotFoundError({
              integrationID: ctx.params.integrationID,
              message: `Integration not found: ${ctx.params.integrationID}`,
            })
          return yield* response(
            service.oauth
              .status({
                integrationID: ctx.params.integrationID,
                attemptID: ctx.params.attemptID,
              })
              .pipe(
                Effect.mapError(
                  (error) =>
                    new IntegrationAttemptNotFoundError({
                      integrationID: error.integrationID,
                      attemptID: error.attemptID,
                      message: `OAuth attempt not found: ${error.attemptID}`,
                    }),
                ),
              ),
          )
        }),
      )
      .handle(
        "integration.oauth.complete",
        Effect.fn(function* (ctx) {
          yield* awaitPlugins
          const service = yield* Integration.Service
          if (!(yield* service.get(ctx.params.integrationID)))
            return yield* new IntegrationNotFoundError({
              integrationID: ctx.params.integrationID,
              message: `Integration not found: ${ctx.params.integrationID}`,
            })
          yield* service.oauth
            .complete({
              integrationID: ctx.params.integrationID,
              attemptID: ctx.params.attemptID,
              code: ctx.payload.code,
            })
            .pipe(
              Effect.mapError((error) => {
                if (error._tag === "Integration.AttemptNotFound")
                  return new IntegrationAttemptNotFoundError({
                    integrationID: error.integrationID,
                    attemptID: error.attemptID,
                    message: `OAuth attempt not found: ${error.attemptID}`,
                  })
                return new InvalidRequestError({
                  message:
                    error._tag === "Integration.CodeRequired"
                      ? "Authorization code is required"
                      : "Authentication failed",
                  kind:
                    error._tag === "Integration.CodeRequired"
                      ? "integration_code_required"
                      : "integration_authorization",
                })
              }),
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
          yield* awaitPlugins
          yield* requireConnectable(ctx.params.integrationID)
          const service = yield* Integration.Service
          const integration = yield* service.get(ctx.params.integrationID)
          if (!integration)
            return yield* new IntegrationNotFoundError({
              integrationID: ctx.params.integrationID,
              message: `Integration not found: ${ctx.params.integrationID}`,
            })
          if (!integration.methods.some((method) => method.type === "command" && method.id === ctx.payload.methodID))
            return yield* new IntegrationMethodNotFoundError({
              integrationID: ctx.params.integrationID,
              methodID: ctx.payload.methodID,
              message: `Integration method not found: ${ctx.payload.methodID}`,
            })
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
          yield* awaitPlugins
          const service = yield* Integration.Service
          if (!(yield* service.get(ctx.params.integrationID)))
            return yield* new IntegrationNotFoundError({
              integrationID: ctx.params.integrationID,
              message: `Integration not found: ${ctx.params.integrationID}`,
            })
          return yield* response(
            service.command
              .status({
                integrationID: ctx.params.integrationID,
                attemptID: ctx.params.attemptID,
              })
              .pipe(
                Effect.mapError(
                  (error) =>
                    new IntegrationAttemptNotFoundError({
                      integrationID: error.integrationID,
                      attemptID: error.attemptID,
                      message: `Command attempt not found: ${error.attemptID}`,
                    }),
                ),
              ),
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
