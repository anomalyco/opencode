import { OpenCode } from "@opencode-ai/client/effect"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { createEmbeddedRoutes } from "@opencode-ai/server/routes"
import { Cause, Context, Effect, Layer } from "effect"
import {
  HttpClient,
  HttpRouter,
  HttpServer,
  HttpServerError,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"

export const create = Effect.fn("OpenCode.create")(function* () {
  const applicationTools = ApplicationTools.layer
  const { handler, permissions, tools } = yield* Effect.all({
    // Reusing this Layer value lets registration and every Location share one memoized host-level registry.
    handler: HttpRouter.toHttpEffect(
      createEmbeddedRoutes().pipe(Layer.provide(applicationTools), Layer.provide(HttpServer.layerServices)),
    ),
    permissions: PermissionSaved.Service,
    tools: ApplicationTools.Service,
  }).pipe(Effect.provide(Layer.merge(applicationTools, PermissionSaved.defaultLayer)))
  const httpClient = HttpClient.make(
    Effect.fnUntraced(function* (request) {
      const response = yield* handler.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromClientRequest(request)),
        Effect.provideService(ApplicationTools.Service, tools),
        Effect.provideService(PermissionSaved.Service, permissions),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : HttpServerError.causeResponse(cause).pipe(Effect.map(([response]) => response)),
        ),
      )
      return HttpServerResponse.toClientResponse(response, { request })
    }, Effect.scoped),
  )
  const client = yield* OpenCode.make({ baseUrl: "http://opencode.local" }).pipe(
    Effect.provideService(HttpClient.HttpClient, httpClient),
  )
  return {
    ...client,
    tools: { register: tools.register },
  }
})

export type Interface = Effect.Success<ReturnType<typeof create>>

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/sdk-next/OpenCode") {}

export const layer = Layer.effect(Service, create())
