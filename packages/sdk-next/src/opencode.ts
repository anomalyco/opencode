import { OpenCode } from "@opencode-ai/client/effect"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { createEmbeddedRoutes } from "@opencode-ai/server/routes"
import { Context, Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServer } from "effect/unstable/http"

export const create = Effect.fn("OpenCode.create")(function* () {
  const applicationTools = ApplicationTools.layer
  const services = Layer.merge(applicationTools, PermissionSaved.defaultLayer)
  const context = yield* Layer.build(services)
  const web = HttpRouter.toWebHandler(
    createEmbeddedRoutes().pipe(Layer.provide(Layer.succeedContext(context)), Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  )
  yield* Effect.addFinalizer(() => Effect.promise(web.dispose))
  const tools = Context.get(context, ApplicationTools.Service)
  const httpClient = HttpClient.make((request, _url, signal) =>
    Effect.gen(function* () {
      const input = yield* HttpClientRequest.toWeb(request, { signal }).pipe(Effect.orDie)
      return HttpClientResponse.fromWeb(request, yield* Effect.promise(() => web.handler(input, context)))
    }),
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
