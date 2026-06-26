import { OpenCode } from "@opencode-ai/client/effect"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { createEmbeddedRoutes } from "@opencode-ai/server/routes"
import { Context, Effect, Layer, Scope } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/unstable/http"

export const create = Effect.fn("OpenCode.create")(function* () {
  const scope = yield* Scope.Scope
  const memoMap = yield* Layer.makeMemoMap
  const context = yield* Layer.buildWithMemoMap(
    Layer.merge(ApplicationTools.layer, PermissionSaved.defaultLayer),
    memoMap,
    scope,
  )
  const tools = Context.get(context, ApplicationTools.Service)
  const permissions = Context.get(context, PermissionSaved.Service)
  const web = yield* Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        createEmbeddedRoutes().pipe(
          HttpRouter.provideRequest(Layer.succeed(PermissionSaved.Service, permissions)),
          Layer.provide(HttpServer.layerServices),
        ),
        { disableLogger: true, memoMap },
      ),
    ),
    (web) => Effect.promise(web.dispose),
  )
  const fetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => web.handler(new Request(input, init)), {
    preconnect: () => undefined,
  }) satisfies typeof globalThis.fetch
  const client = yield* OpenCode.make({ baseUrl: "http://opencode.local" }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
  )
  return {
    ...client,
    tools: { register: tools.register },
  }
})

export type Interface = Effect.Success<ReturnType<typeof create>>

export class Service extends Context.Service<Service, Interface>()("@opencode-ai/sdk-next/OpenCode") {}

export const layer = Layer.effect(Service, create())
