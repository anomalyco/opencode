import { NodeHttpServer } from "@effect/platform-node"
import { Credential } from "@opencode-ai/core/credential"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { Context, Exit, Layer, Option, Scope } from "effect"
import * as Effect from "effect/Effect"
import { HttpRouter, HttpServer, HttpServerError } from "effect/unstable/http"
import { createServer } from "node:http"
import { resolveBindAddresses } from "@opencode-ai/server/bind-address"
import { createRoutes } from "@opencode-ai/server/routes"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Daemon } from "../../services/daemon"

export default Runtime.handler(
  Commands.commands.serve,
  Effect.fn("cli.serve")(function* (input) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const daemon = yield* Daemon.Service
        const address = yield* listen(input.hostname, input.port, yield* daemon.password())
        if (input.register) yield* daemon.register(address)
        console.log(`server listening on ${HttpServer.formatAddress(address)}`)
        return yield* Effect.never
      }),
    )
  }),
)

function listen(hostname: string, port: Option.Option<number>, password: string) {
  return Effect.gen(function* () {
    const addresses = yield* resolveBindAddresses(hostname)
    const memoMap = yield* Layer.makeMemoMap
    const routes = createRoutes(password)
    const app = AppNodeBuilder.build(LayerNode.group([Credential.node, PermissionSaved.node]))
    const layer = (bindPort: number, bindAddress: string) =>
      HttpRouter.serve(routes, { disableListenLog: true, disableLogger: true }).pipe(
        Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { port: bindPort, host: bindAddress })),
        Layer.provide(app),
      )
    const attempt = (port: number) =>
      Effect.gen(function* () {
        // A forked scope makes each port attempt all-or-nothing: a conflict on
        // any address closes the partially bound listeners before trying the next port.
        const attemptScope = yield* Scope.fork(yield* Effect.scope, "sequential")
        const bound = yield* Effect.gen(function* () {
          const first = addresses[0]
          const firstContext = yield* Layer.buildWithMemoMap(layer(port, first), memoMap, attemptScope)
          const firstAddress = Context.get(firstContext, HttpServer.HttpServer).address
          if (firstAddress._tag !== "TcpAddress")
            return yield* Effect.die(new Error("Server listener produced a non-TCP address"))
          // An ephemeral port resolves per socket, so the remaining addresses
          // bind the concrete port the first address actually received.
          yield* Effect.forEach(addresses.slice(1), (bindAddress) =>
            Layer.buildWithMemoMap(layer(firstAddress.port, bindAddress), memoMap, attemptScope),
          )
          // Report the requested hostname rather than a resolved literal so
          // clients resolve it themselves and reach a bound address on any family.
          const address: HttpServer.Address = { _tag: "TcpAddress", hostname, port: firstAddress.port }
          return address
        }).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(attemptScope, exit) : Effect.void)))
        return bound
      })
    if (Option.isSome(port)) return yield* attempt(port.value)
    const next = (port: number): ReturnType<typeof attempt> =>
      attempt(port).pipe(
        Effect.catch((error) => (port === 65_535 || !isAddressInUse(error) ? Effect.fail(error) : next(port + 1))),
      )
    return yield* next(4096)
  })
}

function isAddressInUse(error: unknown) {
  return (
    error instanceof HttpServerError.ServeError &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "code" in error.cause &&
    error.cause.code === "EADDRINUSE"
  )
}
